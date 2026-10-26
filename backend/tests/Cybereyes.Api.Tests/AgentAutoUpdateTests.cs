using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    /// <summary>Relogio do atualizador adiantado pelo teste (os procedimentos continuam com o horario real).</summary>
    private sealed class ShiftedClock : TimeProvider
    {
        public TimeSpan Offset { get; set; }

        public override DateTimeOffset GetUtcNow() => base.GetUtcNow() + Offset;
    }

    [Fact]
    public async Task AutoUpdate_SendsOnceAcrossReplicas_RecordsTheAgentError_AndBacksOff()
    {
        const string error = "error: SHA-256 do binario baixado nao confere";
        var (admin, pk, agent) = await FakeAgentAsync("Cliente atualizacao automatica", "linux", r => r.GetString("func") == AgentUpdates.Func ? error : null);
        await using var _ = agent;
        // Arquitetura que so este agente tem: o atualizador ignora os agentes dos outros testes (nao ha binario para eles).
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            var row = await db.Agents.SingleAsync(a => a.Id == pk);
            row.Version = "3.77.0";
            row.GoArch = "riscv64";
            row.Status = AgentStatus.Online;
            row.LastSeen = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        }
        var binaries = Directory.CreateTempSubdirectory("eyes-auto-update").FullName;
        var binary = Path.Combine(binaries, "eyes-v3.77.1-linux-riscv64");
        await File.WriteAllTextAsync(binary, "binario");
        var settings = Options.Create(new AgentSettings { LatestVersion = "3.77.1", BinariesPath = binaries });
        var clock = new ShiftedClock();
        AgentAutoUpdater Replica() => new(fixture.Services.GetRequiredService<IServiceScopeFactory>(), settings,
            fixture.Services.GetRequiredService<IAgentRpc>(), clock, NullLogger<AgentAutoUpdater>.Instance);
        int Updates()
        {
            lock (agent.Received)
            {
                return agent.Received.Count(r => r.GetString("func") == AgentUpdates.Func);
            }
        }

        // As duas replicas da API rodam no mesmo instante: so uma manda.
        var sent = await Task.WhenAll(Replica().RunOnceAsync(CancellationToken.None), Replica().RunOnceAsync(CancellationToken.None));
        Assert.Equal(1, sent.Sum());
        Assert.Equal(1, Updates());
        var payload = (IReadOnlyDictionary<string, object?>)agent.Received.Single(r => r.GetString("func") == AgentUpdates.Func)["payload"]!;
        Assert.Equal("3.77.1", payload.GetString("version"));
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(binary))), payload.GetString("sha256"));

        // O erro do agente fica no procedimento.
        var procedure = Assert.Single(await ProceduresAsync(admin, $"agentId={pk}"));
        Assert.Equal(ProcedureKind.AgentUpdate, procedure.GetProperty("kind").GetString());
        Assert.Equal("3.77.0 para 3.77.1", procedure.GetProperty("title").GetString());
        Assert.Equal(ProcedureStatus.Error, procedure.GetProperty("status").GetString());
        Assert.Equal(error, procedure.GetProperty("detail").GetString());
        Assert.Equal("Atualização automática", procedure.GetProperty("userName").GetString());

        // Meia hora depois (proxima rodada) ainda nao tenta de novo; depois de RetryAfter, sim; e para em MaxAttempts.
        clock.Offset = TimeSpan.FromMinutes(30);
        Assert.Equal(0, await Replica().RunOnceAsync(CancellationToken.None));
        for (var attempt = 2; attempt <= AgentAutoUpdater.MaxAttempts; attempt++)
        {
            clock.Offset += AgentAutoUpdater.RetryAfter;
            Assert.Equal(1, await Replica().RunOnceAsync(CancellationToken.None));
        }
        clock.Offset += AgentAutoUpdater.RetryAfter;
        Assert.Equal(0, await Replica().RunOnceAsync(CancellationToken.None));
        Assert.Equal(AgentAutoUpdater.MaxAttempts, Updates());
        Assert.Equal(AgentAutoUpdater.MaxAttempts, (await ProceduresAsync(admin, $"agentId={pk}")).Count);
    }
}
