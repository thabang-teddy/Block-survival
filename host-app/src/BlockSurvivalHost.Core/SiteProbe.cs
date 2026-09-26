using System.Net;
using System.Net.Http.Headers;

namespace BlockSurvivalHost.Core;

public sealed record ProbeResult(bool Ok, string Message);

/// <summary>
/// Checks a host token against the site before it is saved. It asks for the ICE
/// servers: a read-only host route, so checking never opens or closes a world.
/// </summary>
public sealed class SiteProbe(HttpClient http)
{
    public async Task<ProbeResult> CheckTokenAsync(string site, string token, CancellationToken ct = default)
    {
        if (!SiteRules.IsAllowed(site, out var problem)) return new ProbeResult(false, problem);
        if (string.IsNullOrWhiteSpace(token)) return new ProbeResult(false, "Paste the host token from the site's Host PCs page.");
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{SiteRules.Normalize(site)}/api/host/ice-servers");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Trim());
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        try
        {
            using var res = await http.SendAsync(req, ct);
            return res.StatusCode switch
            {
                HttpStatusCode.OK => new ProbeResult(true, "The site accepted this token."),
                HttpStatusCode.Unauthorized => new ProbeResult(false, "The site refused this token — it was mistyped, rotated, removed or disabled."),
                HttpStatusCode.NotFound => new ProbeResult(false, "That address has no Block Survival host API — check the site address."),
                HttpStatusCode.ServiceUnavailable => new ProbeResult(false, "The site is in maintenance mode right now; try again later."),
                HttpStatusCode.TooManyRequests => new ProbeResult(false, "The site is rate-limiting this PC; wait a minute and try again."),
                _ => new ProbeResult(false, $"The site answered {(int)res.StatusCode} {res.ReasonPhrase}."),
            };
        }
        catch (HttpRequestException e)
        {
            return new ProbeResult(false, $"Could not reach the site: {e.Message}");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return new ProbeResult(false, "The site did not answer in time.");
        }
    }
}
