using System.Text.Json;
using BlockSurvivalHost.Core;

namespace BlockSurvivalHost.Core.Tests;

public sealed class HostConfigTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "bsh-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private static HostConfig Valid() => new()
    {
        Site = "https://game.example",
        Worlds = [new WorldEntry { Id = "home", Name = "Home", TokenProtected = "AQAA" }],
    };

    [Fact]
    public void Saves_what_pc_host_reads_and_loads_it_back()
    {
        var path = Path.Combine(_dir, "config.json");
        ConfigStore.Save(path, Valid());

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        Assert.Equal("https://game.example", root.GetProperty("site").GetString());
        Assert.Equal(JsonValueKind.Array, root.GetProperty("portRange").ValueKind);
        Assert.Equal(47810, root.GetProperty("controlPort").GetInt32());
        var world = root.GetProperty("worlds")[0];
        Assert.Equal("home", world.GetProperty("id").GetString());
        Assert.Equal("AQAA", world.GetProperty("tokenProtected").GetString());
        Assert.True(world.GetProperty("autoStart").GetBoolean());
        // no plain token is ever written
        Assert.False(world.TryGetProperty("token", out _));

        var back = ConfigStore.Load(path)!;
        Assert.Equal("home", back.Worlds.Single().Id);
        Assert.Equal([50000, 50199], back.PortRange);
        Assert.False(File.Exists(path + ".tmp"));
    }

    [Fact]
    public void No_file_is_a_first_run_and_a_single_world_config_is_one_world()
    {
        Assert.Null(ConfigStore.Load(Path.Combine(_dir, "missing.json")));

        Directory.CreateDirectory(_dir);
        var path = Path.Combine(_dir, "old.json");
        File.WriteAllText(path, """{ "site": "http://block-survival.test", "token": "abcdefghijklmnopqrstuvwxyz", "portRange": [50000, 50100], "relayOnly": true }""");
        var cfg = ConfigStore.Load(path)!;
        Assert.True(cfg.RelayOnly);
        Assert.Equal([50000, 50100], cfg.PortRange);
        var world = Assert.Single(cfg.Worlds);
        Assert.Equal("main", world.Id);
        Assert.Equal("abcdefghijklmnopqrstuvwxyz", world.Token);
        Assert.Empty(cfg.Problems());
    }

    [Fact]
    public void Problems_are_the_ones_pc_host_would_refuse()
    {
        Assert.Empty(Valid().Problems());
        Assert.Contains((Valid() with { Site = "http://game.example" }).Problems(), p => p.Contains("https"));
        Assert.Contains((Valid() with { Site = "game.example" }).Problems(), p => p.Contains("web address"));
        Assert.Empty((Valid() with { Site = "http://localhost:8000" }).Problems());
        Assert.Empty((Valid() with { Site = "http://block-survival.test" }).Problems());
        Assert.Contains((Valid() with { PortRange = [50100, 50000] }).Problems(), p => p.Contains("range"));
        Assert.Contains((Valid() with { ControlPort = 80 }).Problems(), p => p.Contains("control port"));

        var two = Valid().WithWorld(new WorldEntry { Id = "attic", Name = "Attic", TokenProtected = "x" });
        Assert.Contains((two with { PortRange = [50000, 50019] }).Problems(), p => p.Contains("room for 1"));
        Assert.Contains(Valid().WithWorld(new WorldEntry { Id = "HOME", Name = "Dup", TokenProtected = "x" }).Problems(), p => p.Contains("share"));
        Assert.Contains(Valid().WithWorld(new WorldEntry { Id = "x", Name = "No token" }).Problems(), p => p.Contains("token"));
    }

    [Fact]
    public void World_ids_come_from_the_name_and_stay_unique()
    {
        var cfg = Valid();
        Assert.Equal("attic-pc", cfg.NewWorldId("  Attic PC! "));
        Assert.Equal("home-2", cfg.NewWorldId("Home"));
        Assert.Equal("world", cfg.NewWorldId("!!!"));
        Assert.True(cfg.NewWorldId(new string('a', 60)).Length <= 24);
    }

    [Fact]
    public void Worlds_are_added_replaced_and_removed_without_touching_the_rest()
    {
        var cfg = Valid().WithWorld(new WorldEntry { Id = "attic", Name = "Attic", TokenProtected = "x" });
        var renamed = cfg.ReplaceWorld(cfg.Worlds[1] with { Name = "Loft" });
        Assert.Equal(["Home", "Loft"], renamed.Worlds.Select(w => w.Name));
        Assert.Equal(["Home", "Attic"], cfg.Worlds.Select(w => w.Name));
        Assert.Equal(["home"], renamed.WithoutWorld("attic").Worlds.Select(w => w.Id));
    }

    [Fact]
    public void A_protected_token_reads_back_only_through_dpapi()
    {
        var token = new string('t', 48);
        var stored = TokenProtector.Protect(token);
        Assert.DoesNotContain(token, stored);
        Assert.Equal(token, TokenProtector.Unprotect(stored));
    }
}
