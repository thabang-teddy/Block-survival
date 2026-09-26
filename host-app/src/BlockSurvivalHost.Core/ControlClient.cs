using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlockSurvivalHost.Core;

/// <summary>one world as the service reports it (pc-host/src/supervisor/Supervisor.ts WorldStatus)</summary>
public sealed record WorldStatus
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";

    /// <summary>stopped, starting, online, frozen, stopping, crashed, revoked or error</summary>
    public string Phase { get; init; } = "stopped";

    public int Players { get; init; }
    public string? Code { get; init; }
    public int? Pid { get; init; }
    public int Restarts { get; init; }
    public long? LastReportAt { get; init; }
    public string? Error { get; init; }
}

public sealed record ServiceStatus
{
    public string Version { get; init; } = "";

    /// <summary>what is wrong with config.json, if anything</summary>
    public string? Problem { get; init; }

    public IReadOnlyList<WorldStatus> Worlds { get; init; } = [];
}

/// <summary>the service is not running, or its control API refused us</summary>
public sealed class ControlException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Talks to the running service's control API on 127.0.0.1 (pc-host/src/supervisor/control.ts)
/// with the key it wrote to the data folder. Stop and restart wait for the world to save.
/// </summary>
public sealed class ControlClient(HttpClient http, HostPaths paths, Func<int> controlPort)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public Task<ServiceStatus> StatusAsync(CancellationToken ct = default) => SendAsync<ServiceStatus>(HttpMethod.Get, "/status", ct);

    public Task StartAsync(string id, CancellationToken ct = default) => SendAsync<JsonElement>(HttpMethod.Post, $"/worlds/{Uri.EscapeDataString(id)}/start", ct);

    /// <summary>the world saves and goes offline on the site</summary>
    public Task StopAsync(string id, CancellationToken ct = default) => SendAsync<JsonElement>(HttpMethod.Post, $"/worlds/{Uri.EscapeDataString(id)}/stop", ct);

    /// <summary>players stay paused while it restarts</summary>
    public Task RestartAsync(string id, CancellationToken ct = default) => SendAsync<JsonElement>(HttpMethod.Post, $"/worlds/{Uri.EscapeDataString(id)}/restart", ct);

    public Task StopAllAsync(CancellationToken ct = default) => SendAsync<JsonElement>(HttpMethod.Post, "/stop-all", ct);

    /// <summary>re-read config.json; a broken one is a <see cref="ControlException"/> saying what is wrong</summary>
    public Task ReloadAsync(CancellationToken ct = default) => SendAsync<JsonElement>(HttpMethod.Post, "/reload", ct);

    public async Task<IReadOnlyList<string>> LogAsync(string id, int lines = 300, CancellationToken ct = default)
    {
        var body = await SendAsync<LogLines>(HttpMethod.Get, $"/worlds/{Uri.EscapeDataString(id)}/log?lines={lines}", ct);
        return body.Lines;
    }

    private sealed record LogLines(IReadOnlyList<string> Lines);

    private sealed record ErrorBody(string? Message);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, CancellationToken ct)
    {
        string key;
        try
        {
            key = (await File.ReadAllTextAsync(paths.KeyPath, ct)).Trim();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ControlException("The host service has not started yet (no control key).", e);
        }
        using var req = new HttpRequestMessage(method, $"http://127.0.0.1:{controlPort()}{path}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        HttpResponseMessage res;
        try
        {
            res = await http.SendAsync(req, ct);
        }
        catch (HttpRequestException e)
        {
            throw new ControlException("The host service is not running.", e);
        }
        using (res)
        {
            if (!res.IsSuccessStatusCode)
            {
                var error = await ReadErrorAsync(res, ct);
                throw new ControlException(error ?? $"The host service answered {(int)res.StatusCode}.");
            }
            return (await res.Content.ReadFromJsonAsync<T>(Json, ct))!;
        }
    }

    private static async Task<string?> ReadErrorAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            return (await res.Content.ReadFromJsonAsync<ErrorBody>(Json, ct))?.Message;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
