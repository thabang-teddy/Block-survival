using System.Net;
using BlockSurvivalHost.Core;

namespace BlockSurvivalHost.Core.Tests;

public sealed class SiteProbeTests
{
    private static SiteProbe Probe(HttpStatusCode status, List<HttpRequestMessage>? seen = null) =>
        new(new HttpClient(new StubHandler(req =>
        {
            seen?.Add(req);
            return StubHandler.Json(status, "{}");
        })));

    [Fact]
    public async Task Asks_a_read_only_host_route_with_the_token()
    {
        var seen = new List<HttpRequestMessage>();
        var result = await Probe(HttpStatusCode.OK, seen).CheckTokenAsync("https://game.example/", " tok ");
        Assert.True(result.Ok);
        var req = Assert.Single(seen);
        Assert.Equal(HttpMethod.Get, req.Method);
        Assert.Equal("https://game.example/api/host/ice-servers", req.RequestUri!.ToString());
        Assert.Equal("Bearer tok", req.Headers.Authorization!.ToString());
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "refused")]
    [InlineData(HttpStatusCode.NotFound, "site address")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "maintenance")]
    [InlineData(HttpStatusCode.InternalServerError, "500")]
    public async Task Explains_a_refusal(HttpStatusCode status, string says)
    {
        var result = await Probe(status).CheckTokenAsync("https://game.example", "tok");
        Assert.False(result.Ok);
        Assert.Contains(says, result.Message);
    }

    [Fact]
    public async Task Never_sends_a_token_to_a_plain_http_site()
    {
        var seen = new List<HttpRequestMessage>();
        var result = await Probe(HttpStatusCode.OK, seen).CheckTokenAsync("http://game.example", "tok");
        Assert.False(result.Ok);
        Assert.Empty(seen);
    }

    [Fact]
    public async Task An_unreachable_site_is_said_so()
    {
        var probe = new SiteProbe(new HttpClient(new StubHandler(_ => throw new HttpRequestException("No such host"))));
        var result = await probe.CheckTokenAsync("https://game.example", "tok");
        Assert.False(result.Ok);
        Assert.Contains("Could not reach", result.Message);
    }
}

public sealed class ControlClientTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "bsh-tests-" + Guid.NewGuid().ToString("N"));
    private readonly HostPaths _paths;

    public ControlClientTests()
    {
        _paths = new HostPaths(_dir, _dir);
        Directory.CreateDirectory(_dir);
    }

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private ControlClient Client(StubHandler handler) => new(new HttpClient(handler), _paths, () => 47811);

    [Fact]
    public async Task Reads_the_status_with_the_key_the_service_wrote()
    {
        File.WriteAllText(_paths.KeyPath, "secret-key\n");
        var handler = new StubHandler(_ => StubHandler.Json(HttpStatusCode.OK, """
            {"version":"0.2.0","problem":null,"worlds":[{"id":"home","name":"Home","phase":"online","players":2,"code":"PCPCPC","pid":42,"restarts":1,"lastReportAt":1790429611175,"error":null}]}
            """));
        var status = await Client(handler).StatusAsync();
        var world = Assert.Single(status.Worlds);
        Assert.Equal("online", world.Phase);
        Assert.Equal(2, world.Players);
        Assert.Equal(1790429611175, world.LastReportAt);
        var req = Assert.Single(handler.Requests);
        Assert.Equal("http://127.0.0.1:47811/status", req.RequestUri!.ToString());
        Assert.Equal("Bearer secret-key", req.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task Start_stop_restart_and_reload_go_to_their_routes()
    {
        File.WriteAllText(_paths.KeyPath, "k");
        var handler = new StubHandler(_ => StubHandler.Json(HttpStatusCode.OK, """{"worlds":[]}"""));
        var client = Client(handler);
        await client.StartAsync("home");
        await client.StopAsync("home");
        await client.RestartAsync("home");
        await client.StopAllAsync();
        await client.ReloadAsync();
        Assert.Equal(
            ["/worlds/home/start", "/worlds/home/stop", "/worlds/home/restart", "/stop-all", "/reload"],
            handler.Requests.Select(r => r.RequestUri!.AbsolutePath));
        Assert.All(handler.Requests, r => Assert.Equal(HttpMethod.Post, r.Method));
    }

    [Fact]
    public async Task The_services_own_words_come_back_as_the_error()
    {
        File.WriteAllText(_paths.KeyPath, "k");
        var handler = new StubHandler(_ => StubHandler.Json(HttpStatusCode.UnprocessableEntity, """{"message":"\"worlds\" must be a list"}"""));
        var e = await Assert.ThrowsAsync<ControlException>(() => Client(handler).ReloadAsync());
        Assert.Equal("\"worlds\" must be a list", e.Message);
    }

    [Fact]
    public async Task A_service_that_is_not_running_is_said_so()
    {
        await Assert.ThrowsAsync<ControlException>(() => Client(new StubHandler(_ => StubHandler.Json(HttpStatusCode.OK, "{}"))).StatusAsync());
        File.WriteAllText(_paths.KeyPath, "k");
        var down = new StubHandler(_ => throw new HttpRequestException("refused"));
        var e = await Assert.ThrowsAsync<ControlException>(() => Client(down).StatusAsync());
        Assert.Contains("not running", e.Message);
    }

    [Fact]
    public async Task Tails_a_world_log()
    {
        File.WriteAllText(_paths.KeyPath, "k");
        var handler = new StubHandler(_ => StubHandler.Json(HttpStatusCode.OK, """{"lines":["a","b"]}"""));
        Assert.Equal(["a", "b"], await Client(handler).LogAsync("home", 50));
        Assert.Equal("/worlds/home/log?lines=50", handler.Requests.Single().RequestUri!.PathAndQuery);
    }
}

public sealed class AdminSetupTests
{
    private static readonly HostPaths Paths = new(@"C:\Program Files\Block Survival Host", @"C:\ProgramData\BlockSurvivalHost");

    [Fact]
    public void The_service_runs_the_supervisor_with_its_data_in_programdata()
    {
        var xml = System.Xml.Linq.XDocument.Parse(AdminSetup.ServiceXml(Paths)).Root!;
        Assert.Equal(HostPaths.ServiceName, xml.Element("id")!.Value);
        Assert.Equal("\"%BASE%\\dist\\pc-host.mjs\" service", xml.Element("arguments")!.Value);
        var env = xml.Element("env")!;
        Assert.Equal("PC_HOST_HOME", env.Attribute("name")!.Value);
        Assert.Equal(Paths.DataDir, env.Attribute("value")!.Value);
        Assert.Equal("Automatic", xml.Element("startmode")!.Value);
    }

    [Fact]
    public void The_firewall_rule_opens_only_udp_for_node_on_the_range()
    {
        var steps = AdminSetup.FirewallSteps(Paths, 50000, 50199);
        Assert.True(steps[0].MayFail);
        Assert.Contains("delete", steps[0].Args);
        var add = steps[1].Args;
        Assert.Contains("protocol=UDP", add);
        Assert.Contains("localport=50000-50199", add);
        Assert.Contains($"program={Paths.NodeExe}", add);
        Assert.Contains($"name={AdminSetup.FirewallRule}", add);
    }

    [Fact]
    public void Setup_grants_the_owner_the_data_folder_and_installs_or_restarts_the_service()
    {
        var fresh = AdminSetup.SetupSteps(Paths, @"PC\Teddy", 50000, 50199, serviceInstalled: false);
        Assert.Equal("icacls", fresh[0].FileName);
        Assert.Equal([Paths.DataDir, "/grant", @"PC\Teddy:(OI)(CI)M"], fresh[0].Args);
        Assert.Equal(["install", "start"], fresh.Where(s => s.FileName == Paths.ServiceExe).Select(s => s.Args[0]));

        var again = AdminSetup.SetupSteps(Paths, @"PC\Teddy", 50000, 50199, serviceInstalled: true);
        Assert.Equal(["stopwait", "start"], again.Where(s => s.FileName == Paths.ServiceExe).Select(s => s.Args[0]));
    }

    [Fact]
    public void Uninstall_removes_the_service_and_the_rule_even_when_half_of_it_is_gone()
    {
        var steps = AdminSetup.UninstallSteps(Paths);
        Assert.All(steps, s => Assert.True(s.MayFail));
        Assert.Contains(steps, s => s.Args.Contains("uninstall"));
        Assert.Contains(steps, s => s.FileName == "netsh");
    }

    [Fact]
    public void Running_stops_at_the_first_real_failure_and_skips_ones_that_may_fail()
    {
        var log = new List<string>();
        var failures = AdminSetup.Run(
        [
            new AdminStep("missing but optional", "definitely-not-a-program-xyz", [], MayFail: true),
            new AdminStep("fails", "cmd", ["/c", "exit 3"]),
            new AdminStep("never runs", "cmd", ["/c", "exit 0"]),
        ], log.Add);
        Assert.Equal(["fails (exit code 3)"], failures);
        Assert.DoesNotContain("> never runs", log);
    }
}
