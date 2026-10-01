using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;

namespace WinCare.Api.Rmm.Monitoring;

public static class SettingsStore
{
    public const string SmtpPurpose = "WinCare.Settings.Smtp";

    public static async Task<CoreSettings> GetAsync(WinCareDbContext db, CancellationToken ct)
    {
        var settings = await db.CoreSettings.FirstOrDefaultAsync(s => s.Id == 1, ct);
        if (settings is not null)
        {
            return settings;
        }
        settings = new CoreSettings();
        db.CoreSettings.Add(settings);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.Entry(settings).State = EntityState.Detached;
            settings = await db.CoreSettings.FirstAsync(s => s.Id == 1, ct);
        }
        return settings;
    }

    public static TimeZoneInfo TimeZone(CoreSettings settings) =>
        TimeZoneInfo.TryFindSystemTimeZoneById(settings.TimeZone, out var tz) ? tz : TimeZoneInfo.Utc;
}

public sealed record EffectivePolicy(int PolicyId, string Name, string Source);

/// <summary>Politicas que valem para um agente, da mais especifica para a mais geral, respeitando o bloqueio de heranca.</summary>
public static class PolicyResolver
{
    public static async Task<IReadOnlyList<EffectivePolicy>> ForAgentAsync(WinCareDbContext db, int agentId, CancellationToken ct)
    {
        var a = await db.Agents.AsNoTracking().Where(x => x.Id == agentId)
            .Select(x => new
            {
                x.PolicyId, x.BlockPolicyInheritance, x.MonitoringType,
                SiteServer = x.Site!.ServerPolicyId, SiteWorkstation = x.Site.WorkstationPolicyId, SiteBlock = x.Site.BlockPolicyInheritance,
                ClientServer = x.Site.Client!.ServerPolicyId, ClientWorkstation = x.Site.Client.WorkstationPolicyId, ClientBlock = x.Site.Client.BlockPolicyInheritance,
            }).FirstOrDefaultAsync(ct);
        if (a is null)
        {
            return [];
        }

        var settings = await SettingsStore.GetAsync(db, ct);
        var server = a.MonitoringType == MonitoringType.Server;
        var chain = new List<(int? Id, string Source)> { (a.PolicyId, "agente") };
        if (!a.BlockPolicyInheritance)
        {
            chain.Add((server ? a.SiteServer : a.SiteWorkstation, "site"));
            if (!a.SiteBlock)
            {
                chain.Add((server ? a.ClientServer : a.ClientWorkstation, "cliente"));
                if (!a.ClientBlock)
                {
                    chain.Add((server ? settings.DefaultServerPolicyId : settings.DefaultWorkstationPolicyId, "global"));
                }
            }
        }

        var ids = chain.Where(c => c.Id is not null).Select(c => c.Id!.Value).Distinct().ToList();
        var policies = await db.Policies.AsNoTracking().Where(p => ids.Contains(p.Id) && p.Enabled).ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        return chain.Where(c => c.Id is { } id && policies.ContainsKey(id))
            .DistinctBy(c => c.Id)
            .Select(c => new EffectivePolicy(c.Id!.Value, policies[c.Id!.Value], c.Source)).ToList();
    }

    public static async Task<List<Check>> ChecksForAgentAsync(WinCareDbContext db, int agentId, CancellationToken ct)
    {
        var policyIds = (await ForAgentAsync(db, agentId, ct)).Select(p => p.PolicyId).ToList();
        return await db.Checks.AsNoTracking().Where(c => c.AgentId == agentId || (c.PolicyId != null && policyIds.Contains(c.PolicyId.Value))).ToListAsync(ct);
    }

    public static async Task<List<AutomatedTask>> TasksForAgentAsync(WinCareDbContext db, int agentId, CancellationToken ct)
    {
        var policyIds = (await ForAgentAsync(db, agentId, ct)).Select(p => p.PolicyId).ToList();
        return await db.Tasks.AsNoTracking().Where(t => t.AgentId == agentId || (t.PolicyId != null && policyIds.Contains(t.PolicyId.Value))).ToListAsync(ct);
    }
}

public sealed record CheckOutcome(double? HistoryValue, string? HistoryResults);

/// <summary>Avalia o resultado enviado pelo agente com as mesmas regras do Tactical RMM.</summary>
public static class CheckEvaluator
{
    public static CheckOutcome Apply(Check check, CheckResult result, JsonElement data, DateTimeOffset now)
    {
        CheckOutcome outcome;
        switch (check.CheckType)
        {
            case CheckTypes.CpuLoad or CheckTypes.Memory:
            {
                var percent = Int(data, "percent");
                result.History.Add(percent);
                if (result.History.Count > 15)
                {
                    result.History.RemoveRange(0, result.History.Count - 15);
                }
                var avg = (int)result.History.Average();
                result.MoreInfo = string.Create(CultureInfo.InvariantCulture,
                    $"{(check.CheckType == CheckTypes.Memory ? "Uso medio de memoria" : "Carga media de CPU")}: {avg}%");
                SetThreshold(result, check.ErrorThreshold > 0 && avg > check.ErrorThreshold, check.WarningThreshold > 0 && avg > check.WarningThreshold);
                outcome = new CheckOutcome(percent, null);
                break;
            }
            case CheckTypes.DiskSpace:
                if (Bool(data, "exists"))
                {
                    var free = 100 - (int)Math.Round(Double(data, "percent_used"));
                    SetThreshold(result, check.ErrorThreshold > 0 && free < check.ErrorThreshold, check.WarningThreshold > 0 && free < check.WarningThreshold);
                    result.MoreInfo = Text(data, "more_info");
                    outcome = new CheckOutcome(free, null);
                }
                else
                {
                    result.Status = CheckStatus.Failing;
                    result.AlertSeverity = Severity.Error;
                    result.MoreInfo = $"O disco {check.Disk} nao existe";
                    outcome = new CheckOutcome(null, result.MoreInfo);
                }
                break;
            case CheckTypes.Script:
            {
                var retcode = (long)Double(data, "retcode");
                result.Stdout = Text(data, "stdout");
                result.Stderr = Text(data, "stderr");
                result.Retcode = retcode;
                result.ExecutionTime = Double(data, "runtime");
                if (check.InfoReturnCodes.Contains(retcode))
                {
                    Fail(result, Severity.Info);
                }
                else if (check.WarningReturnCodes.Contains(retcode))
                {
                    Fail(result, Severity.Warning);
                }
                else if (check.SuccessReturnCodes.Contains(retcode) || retcode == 0)
                {
                    result.Status = CheckStatus.Passing;
                }
                else
                {
                    Fail(result, Severity.Error);
                }
                outcome = new CheckOutcome(result.Status == CheckStatus.Failing ? 1 : 0, Trim($"retcode {retcode}: {result.Stdout}"));
                break;
            }
            case CheckTypes.Ping:
                result.Status = Text(data, "status") == CheckStatus.Failing ? CheckStatus.Failing : CheckStatus.Passing;
                result.AlertSeverity = check.AlertSeverity;
                result.MoreInfo = Text(data, "output");
                outcome = new CheckOutcome(result.Status == CheckStatus.Failing ? 1 : 0, Trim(result.MoreInfo));
                break;
            case CheckTypes.WinSvc:
                result.Status = Text(data, "status") == CheckStatus.Failing ? CheckStatus.Failing : CheckStatus.Passing;
                result.AlertSeverity = check.AlertSeverity;
                result.MoreInfo = Text(data, "more_info");
                outcome = new CheckOutcome(result.Status == CheckStatus.Failing ? 1 : 0, Trim(result.MoreInfo));
                break;
            case CheckTypes.EventLog:
            {
                var log = data.TryGetProperty("log", out var l) && l.ValueKind == JsonValueKind.Array ? l : default;
                var count = log.ValueKind == JsonValueKind.Array ? log.GetArrayLength() : 0;
                var enough = count > 0 && count >= check.NumberOfEventsBeforeAlert;
                result.Status = (check.FailWhen == "not_contains" ? !enough : enough) ? CheckStatus.Failing : CheckStatus.Passing;
                result.AlertSeverity = check.AlertSeverity;
                result.ExtraDetails = JsonSerializer.Serialize(new { log = log.ValueKind == JsonValueKind.Array ? (object)log : Array.Empty<object>() });
                result.MoreInfo = $"Eventos encontrados: {count}";
                outcome = new CheckOutcome(result.Status == CheckStatus.Failing ? 1 : 0, result.MoreInfo);
                break;
            }
            default:
                return new CheckOutcome(null, null);
        }

        result.LastRun = now;
        result.FailCount = result.Status == CheckStatus.Failing ? result.FailCount + 1 : 0;
        return outcome;
    }

    private static void SetThreshold(CheckResult result, bool error, bool warning)
    {
        if (error)
        {
            Fail(result, Severity.Error);
        }
        else if (warning)
        {
            Fail(result, Severity.Warning);
        }
        else
        {
            result.Status = CheckStatus.Passing;
        }
    }

    private static void Fail(CheckResult result, string severity)
    {
        result.Status = CheckStatus.Failing;
        result.AlertSeverity = severity;
    }

    private static string? Trim(string? value) => value is null ? null : value.Length <= 60 ? value : value[..60];

    private static string? Text(JsonElement data, string name) =>
        data.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool Bool(JsonElement data, string name) => data.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static double Double(JsonElement data, string name) =>
        data.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    private static int Int(JsonElement data, string name) => (int)Math.Round(Double(data, name));
}
