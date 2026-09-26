using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace BlockSurvivalHost.Core;

/// <summary>
/// One global world this PC runs: a host key from the site's admin page. The token is
/// kept DPAPI-protected (<see cref="TokenProtector"/>); the service reads it itself.
/// </summary>
public sealed record WorldEntry
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string? TokenProtected { get; init; }

    /// <summary>a plain token, from a config written by hand; the app never writes one</summary>
    public string? Token { get; init; }

    public bool AutoStart { get; init; } = true;
}

/// <summary>
/// config.json as pc-host reads it (pc-host/src/hostConfig.ts): the site, the UDP port
/// range (each world gets <see cref="PortsPerWorld"/> of it), the control API's port and
/// the worlds.
/// </summary>
public sealed record HostConfig
{
    public const int PortsPerWorld = 20;
    public const int DefaultControlPort = 47810;
    public static readonly int[] DefaultPortRange = [50000, 50199];

    public string Site { get; init; } = "";
    public bool RelayOnly { get; init; }
    public int[] PortRange { get; init; } = DefaultPortRange;
    public int ControlPort { get; init; } = DefaultControlPort;
    public string LogDir { get; init; } = "logs";
    public IReadOnlyList<WorldEntry> Worlds { get; init; } = [];

    public int FirstPort => PortRange[0];
    public int LastPort => PortRange[1];

    /// <summary>how many worlds the port range has room for</summary>
    public int WorldSlots => Math.Max(0, (LastPort - FirstPort + 1) / PortsPerWorld);

    public HostConfig WithWorld(WorldEntry world) => this with { Worlds = [.. Worlds, world] };

    public HostConfig WithoutWorld(string id) => this with { Worlds = [.. Worlds.Where(w => w.Id != id)] };

    public HostConfig ReplaceWorld(WorldEntry world) => this with { Worlds = [.. Worlds.Select(w => w.Id == world.Id ? world : w)] };

    /// <summary>a short id from the name, unique among this PC's worlds (also its log folder)</summary>
    public string NewWorldId(string name)
    {
        var slug = Regex.Replace(name.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length == 0) slug = "world";
        if (slug.Length > 24) slug = slug[..24].TrimEnd('-');
        var id = slug;
        for (var n = 2; Worlds.Any(w => string.Equals(w.Id, id, StringComparison.OrdinalIgnoreCase)); n++) id = $"{slug}-{n}";
        return id;
    }

    /// <summary>what pc-host would refuse, in words the owner can act on; empty when it is fine</summary>
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (!SiteRules.IsAllowed(Site, out var siteProblem)) problems.Add(siteProblem);
        if (PortRange.Length != 2 || PortRange.Any(p => p < 1024 || p > 65535) || FirstPort > LastPort)
        {
            problems.Add("The UDP ports must be a range between 1024 and 65535.");
        }
        else if (Worlds.Count > WorldSlots)
        {
            problems.Add($"Ports {FirstPort}–{LastPort} have room for {WorldSlots} worlds ({PortsPerWorld} ports each); widen the range.");
        }
        if (ControlPort < 1024 || ControlPort > 65535) problems.Add("The control port must be between 1024 and 65535.");
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var w in Worlds)
        {
            if (!Regex.IsMatch(w.Id, "^[a-z0-9][a-z0-9-]{0,31}$", RegexOptions.IgnoreCase)) problems.Add($"World id \"{w.Id}\" must be letters, digits and dashes.");
            if (!ids.Add(w.Id)) problems.Add($"Two worlds share the id \"{w.Id}\".");
            if (string.IsNullOrWhiteSpace(w.Name) || w.Name.Length > 32) problems.Add($"World \"{w.Id}\" needs a name of 1–32 characters.");
            if (string.IsNullOrEmpty(w.TokenProtected) && (w.Token is null || w.Token.Length < 20)) problems.Add($"World \"{w.Name}\" needs its host token.");
        }
        return problems;
    }
}

/// <summary>the same rule pc-host applies: https, or plain http only for this PC or a .test dev site</summary>
public static partial class SiteRules
{
    [GeneratedRegex(@"^http://(localhost|127\.0\.0\.1|[a-z0-9-]+(\.[a-z0-9-]+)*\.test)(:\d+)?(/|$)", RegexOptions.IgnoreCase)]
    private static partial Regex LocalHttp();

    [GeneratedRegex(@"^https?://[^/\s]+", RegexOptions.IgnoreCase)]
    private static partial Regex AnyHttp();

    public static bool IsAllowed(string site, out string problem)
    {
        problem = "";
        if (!AnyHttp().IsMatch(site ?? ""))
        {
            problem = "The site must be its web address, like https://blocksurvival.example.";
            return false;
        }
        if (!site!.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !LocalHttp().IsMatch(site))
        {
            problem = "The site must use https (plain http is only for this PC or a .test dev site).";
            return false;
        }
        return true;
    }

    /// <summary>the address without a trailing slash, so API paths can be appended</summary>
    public static string Normalize(string site) => site.Trim().TrimEnd('/');
}

/// <summary>reads and writes config.json; a write goes to a temp file first so the service never reads half of one</summary>
public static class ConfigStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    /// <summary>the config, or null when there is none yet (a first run)</summary>
    public static HostConfig? Load(string path)
    {
        if (!File.Exists(path)) return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        // a config.json from before many worlds: one site, one token
        if (!root.TryGetProperty("worlds", out _) && root.TryGetProperty("token", out var token))
        {
            return new HostConfig
            {
                Site = root.GetProperty("site").GetString() ?? "",
                RelayOnly = root.TryGetProperty("relayOnly", out var r) && r.GetBoolean(),
                PortRange = root.TryGetProperty("portRange", out var p) ? p.Deserialize<int[]>() ?? HostConfig.DefaultPortRange : HostConfig.DefaultPortRange,
                Worlds = [new WorldEntry { Id = "main", Name = "Global world", Token = token.GetString() }],
            };
        }
        return root.Deserialize<HostConfig>(Json) ?? new HostConfig();
    }

    public static void Save(string path, HostConfig config)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(config, Json));
        File.Move(temp, path, overwrite: true);
    }
}
