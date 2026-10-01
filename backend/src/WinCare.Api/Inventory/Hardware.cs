using System.Globalization;
using System.Text.Json;

namespace WinCare.Api.Inventory;

public sealed record HardwareInfo(
    string Source, string? Manufacturer, string? Model, string? MakeModel, string? SerialNumber, IReadOnlyList<string> Cpus, IReadOnlyList<string> Gpus,
    int? RamGb, IReadOnlyList<string> Disks, IReadOnlyList<string> LocalIps, string? OperatingSystem, string? LastLoggedInUser, DateTimeOffset? BootTime);

/// <summary>
/// Le o inventario que o agente envia em "agent-wmi". No Windows vem do WMI (listas de listas de objetos por classe);
/// no Linux e macOS vem com chaves simples (make_model, cpus, gpus, disks, local_ips).
/// </summary>
public static class Hardware
{
    private static readonly string[] SerialPlaceholders = ["to be filled by o.e.m.", "default string", "system serial number", "0", "none", "n/a", "unknown", "not specified"];

    public static HardwareInfo? Parse(string? wmiJson, string plat, int? ramGb, string? os, string? lastUser, double? bootSeconds)
    {
        DateTimeOffset? bootTime = bootSeconds is > 0 ? DateTimeOffset.FromUnixTimeSeconds((long)bootSeconds.Value) : null;
        JsonElement root;
        try
        {
            root = string.IsNullOrWhiteSpace(wmiJson) ? default : JsonDocument.Parse(wmiJson).RootElement;
        }
        catch (JsonException)
        {
            root = default;
        }
        if (root.ValueKind != JsonValueKind.Object)
        {
            return ramGb is null && os is null ? null : new HardwareInfo("agent", null, null, null, null, [], [], ramGb, [], [], os, lastUser, bootTime);
        }

        if (plat == "windows")
        {
            var manufacturer = First(root, "comp_sys", "Manufacturer") ?? First(root, "comp_sys_prod", "Vendor");
            var model = First(root, "comp_sys", "Model") ?? First(root, "comp_sys_prod", "Name");
            var serial = CleanSerial(First(root, "bios", "SerialNumber")) ?? CleanSerial(First(root, "comp_sys_prod", "IdentifyingNumber"));
            var disks = Objects(root, "disk").Select(d => Join(Str(d, "Caption") ?? Str(d, "Model"), Size(d))).Where(s => s.Length > 0).ToList();
            var ips = Objects(root, "network_config")
                .Where(n => n.TryGetProperty("IPEnabled", out var on) && on.ValueKind == JsonValueKind.True)
                .SelectMany(n => n.TryGetProperty("IPAddress", out var a) && a.ValueKind == JsonValueKind.Array
                    ? a.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!)
                    : [])
                .ToList();
            return new HardwareInfo("agent", manufacturer, model, Join(manufacturer, model), serial,
                Values(root, "cpu", "Name"), Values(root, "graphics", "Caption"), ramGb, disks, ips, os, lastUser, bootTime);
        }

        var makeModel = string.Join(' ', (Str(root, "make_model") ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(w => !w.Equals("unknown", StringComparison.OrdinalIgnoreCase)));
        return new HardwareInfo("agent", null, null, makeModel.Length == 0 ? null : makeModel, CleanSerial(Str(root, "serialnumber") ?? Str(root, "serial_number")),
            Strings(root, "cpus"), Strings(root, "gpus"), ramGb, Strings(root, "disks"), Strings(root, "local_ips"), os, lastUser, bootTime);
    }

    private static string? CleanSerial(string? serial)
    {
        var value = serial?.Trim();
        return string.IsNullOrEmpty(value) || SerialPlaceholders.Contains(value.ToLowerInvariant()) ? null : value;
    }

    private static string Join(params string?[] parts) => string.Join(' ', parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));

    private static string? Size(JsonElement disk)
    {
        if (!disk.TryGetProperty("Size", out var size))
        {
            return null;
        }
        var bytes = size.ValueKind switch
        {
            JsonValueKind.Number when size.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(size.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0d,
        };
        return bytes > 0 ? string.Create(CultureInfo.InvariantCulture, $"{Math.Round(bytes / 1_000_000_000d)} GB") : null;
    }

    private static string? Str(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static List<string> Strings(JsonElement root, string name) =>
        root.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!.Trim()).Where(x => x.Length > 0).ToList()
            : [];

    /// <summary>Todos os objetos de uma classe do WMI, aceitando listas aninhadas.</summary>
    private static IEnumerable<JsonElement> Objects(JsonElement root, string section)
    {
        if (!root.TryGetProperty(section, out var value))
        {
            yield break;
        }
        var stack = new Stack<JsonElement>([value]);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (current.ValueKind == JsonValueKind.Object)
            {
                yield return current;
            }
            else if (current.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in current.EnumerateArray().Reverse())
                {
                    stack.Push(item);
                }
            }
        }
    }

    private static string? First(JsonElement root, string section, string key) =>
        Objects(root, section).Select(o => Str(o, key)?.Trim()).FirstOrDefault(v => !string.IsNullOrEmpty(v));

    private static List<string> Values(JsonElement root, string section, string key) =>
        Objects(root, section).Select(o => Str(o, key)?.Trim()).Where(v => !string.IsNullOrEmpty(v)).Select(v => v!).Distinct().ToList();
}
