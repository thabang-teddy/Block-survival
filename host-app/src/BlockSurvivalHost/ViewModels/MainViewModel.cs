using System.Collections.ObjectModel;
using System.ServiceProcess;
using System.Windows.Threading;
using BlockSurvivalHost.Core;
using BlockSurvivalHost.Infrastructure;
using BlockSurvivalHost.Services;

namespace BlockSurvivalHost.ViewModels;

/// <summary>
/// The whole app's state: the first-run wizard, then the dashboard — each world with
/// start / stop / restart, the service's health, adding and removing worlds, and the
/// settings. It talks to the service through its control API and to the site only to
/// check a token.
/// </summary>
public sealed class MainViewModel : Observable
{
    private static readonly TimeSpan PollEvery = TimeSpan.FromSeconds(3);
    /// <summary>how long a freshly started service gets to write its control key</summary>
    private static readonly TimeSpan ServiceWarmUp = TimeSpan.FromSeconds(20);

    private readonly HostPaths _paths;
    private readonly ControlClient _control;
    private readonly SiteProbe _probe;
    private readonly DispatcherTimer _timer;
    private HostConfig _config;
    private bool _firstRun;
    private int _wizardStep = 1;
    private string _site = "";
    private string _firstPort;
    private string _lastPort;
    private bool _relayOnly;
    private bool _startWithWindows;
    private string _newWorldName = "Global world";
    private bool _newWorldAutoStart = true;
    private WorldEntry? _pendingWorld;
    private string _serviceText = "Checking the host service…";
    private bool _serviceOk;
    private bool _serviceInstalled;
    private string? _problem;
    private string _message = "";
    private bool _messageIsError;
    private bool _polling;

    public MainViewModel(HostPaths paths, ControlClient control, SiteProbe probe)
    {
        _paths = paths;
        _control = control;
        _probe = probe;
        HostConfig? loaded = null;
        try
        {
            loaded = ConfigStore.Load(paths.ConfigPath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            Say($"config.json could not be read: {e.Message}", error: true);
        }
        _firstRun = loaded is null || loaded.Worlds.Count == 0;
        _config = loaded ?? new HostConfig();
        _site = _config.Site;
        _firstPort = _config.FirstPort.ToString();
        _lastPort = _config.LastPort.ToString();
        _relayOnly = _config.RelayOnly;
        _startWithWindows = StartupRegistration.IsEnabled();
        foreach (var w in _config.Worlds) Worlds.Add(new WorldRow(w));

        StartCommand = new AsyncCommand(p => WorldAction((WorldRow)p!, "Starting", r => _control.StartAsync(r.Id)), p => ServiceOk && p is WorldRow { IsRunning: false });
        StopCommand = new AsyncCommand(p => StopWorld((WorldRow)p!), p => p is WorldRow { IsRunning: true });
        RestartCommand = new AsyncCommand(p => WorldAction((WorldRow)p!, "Restarting", r => _control.RestartAsync(r.Id)), p => p is WorldRow { IsRunning: true });
        RemoveCommand = new AsyncCommand(p => RemoveWorld((WorldRow)p!));
        StartAllCommand = new AsyncCommand(StartAll, () => ServiceOk && Worlds.Any(w => !w.IsRunning));
        StopAllCommand = new AsyncCommand(StopAll, () => Worlds.Any(w => w.IsRunning));
        SaveSettingsCommand = new AsyncCommand(SaveSettings);
        SetUpPcCommand = new AsyncCommand(SetUpPc);
        WizardNextCommand = new AsyncCommand(WizardNext);
        WizardBackCommand = new AsyncCommand(() => { WizardStep = Math.Max(1, WizardStep - 1); return Task.CompletedTask; }, () => WizardStep > 1);

        _timer = new DispatcherTimer { Interval = PollEvery };
        _timer.Tick += async (_, _) => await Refresh();
        _timer.Start();
        _ = Refresh();
    }

    /// <summary>asks the owner to confirm something; the window sets it</summary>
    public Func<string, bool> Confirm { get; set; } = _ => true;

    /// <summary>the view opens a log window for a world</summary>
    public event Action<WorldRow>? OpenLogRequested;

    public ObservableCollection<WorldRow> Worlds { get; } = [];

    public AsyncCommand StartCommand { get; }
    public AsyncCommand StopCommand { get; }
    public AsyncCommand RestartCommand { get; }
    public AsyncCommand RemoveCommand { get; }
    public AsyncCommand StartAllCommand { get; }
    public AsyncCommand StopAllCommand { get; }
    public AsyncCommand SaveSettingsCommand { get; }
    public AsyncCommand SetUpPcCommand { get; }
    public AsyncCommand WizardNextCommand { get; }
    public AsyncCommand WizardBackCommand { get; }

    public void OpenLog(WorldRow row) => OpenLogRequested?.Invoke(row);

    public Task<IReadOnlyList<string>> LogAsync(string id) => _control.LogAsync(id, 400);

    // ------------------------------------------------------------------ state

    public bool IsFirstRun { get => _firstRun; private set { if (Set(ref _firstRun, value)) Raise(nameof(IsDashboard)); } }
    public bool IsDashboard => !_firstRun;

    public int WizardStep
    {
        get => _wizardStep;
        private set
        {
            if (!Set(ref _wizardStep, value)) return;
            Raise(nameof(IsStep1));
            Raise(nameof(IsStep2));
            Raise(nameof(IsStep3));
            Raise(nameof(WizardNextText));
        }
    }

    public bool IsStep1 => _wizardStep == 1;
    public bool IsStep2 => _wizardStep == 2;
    public bool IsStep3 => _wizardStep == 3;
    public string WizardNextText => _wizardStep == 3 ? "Set up this PC" : "Next";

    public string Site { get => _site; set => Set(ref _site, value); }
    public string FirstPort { get => _firstPort; set { if (Set(ref _firstPort, value)) Raise(nameof(PortsHint)); } }
    public string LastPort { get => _lastPort; set { if (Set(ref _lastPort, value)) Raise(nameof(PortsHint)); } }
    public bool RelayOnly { get => _relayOnly; set => Set(ref _relayOnly, value); }
    public bool StartWithWindows { get => _startWithWindows; set => Set(ref _startWithWindows, value); }
    public string NewWorldName { get => _newWorldName; set => Set(ref _newWorldName, value); }
    public bool NewWorldAutoStart { get => _newWorldAutoStart; set => Set(ref _newWorldAutoStart, value); }

    public string ServiceText { get => _serviceText; private set => Set(ref _serviceText, value); }
    public bool ServiceOk { get => _serviceOk; private set => Set(ref _serviceOk, value); }
    public bool ServiceInstalled { get => _serviceInstalled; private set => Set(ref _serviceInstalled, value); }
    public string? Problem { get => _problem; private set { if (Set(ref _problem, value)) Raise(nameof(HasProblem)); } }
    public bool HasProblem => !string.IsNullOrEmpty(_problem);
    public string Message { get => _message; private set => Set(ref _message, value); }
    public bool MessageIsError { get => _messageIsError; private set => Set(ref _messageIsError, value); }
    public string PortsHint => $"Each world uses {HostConfig.PortsPerWorld} UDP ports; this range fits {SlotsFor(FirstPort, LastPort)} worlds.";

    private static int SlotsFor(string first, string last) =>
        int.TryParse(first, out var f) && int.TryParse(last, out var l) && l >= f ? (l - f + 1) / HostConfig.PortsPerWorld : 0;

    private void Say(string text, bool error = false)
    {
        Message = text;
        MessageIsError = error;
    }

    // ------------------------------------------------------------------ polling

    /// <summary>the service's state and every world's, every few seconds</summary>
    public async Task Refresh()
    {
        if (_polling) return;
        _polling = true;
        try
        {
            var state = AdminSetup.ServiceState();
            ServiceInstalled = state is not null;
            if (state is null)
            {
                ServiceOk = false;
                ServiceText = "The host service is not installed — run Set up this PC.";
                foreach (var w in Worlds) w.ApplyUnknown();
                return;
            }
            if (state != ServiceControllerStatus.Running)
            {
                ServiceOk = false;
                ServiceText = $"The host service is {Describe(state.Value)}.";
                foreach (var w in Worlds) w.ApplyUnknown();
                return;
            }
            var status = await _control.StatusAsync();
            ServiceOk = true;
            ServiceText = $"The host service is running (pc-host {status.Version}).";
            Problem = status.Problem;
            foreach (var w in Worlds) w.Apply(status.Worlds.FirstOrDefault(s => s.Id == w.Id));
        }
        catch (ControlException e)
        {
            ServiceOk = false;
            ServiceText = e.Message;
            foreach (var w in Worlds) w.ApplyUnknown();
        }
        finally
        {
            _polling = false;
        }
    }

    private static string Describe(ServiceControllerStatus s) => s switch
    {
        ServiceControllerStatus.Stopped => "stopped",
        ServiceControllerStatus.StartPending => "starting",
        ServiceControllerStatus.StopPending => "stopping",
        _ => s.ToString().ToLowerInvariant(),
    };

    // ------------------------------------------------------------------ worlds

    private async Task WorldAction(WorldRow row, string doing, Func<WorldRow, Task> act)
    {
        Say($"{doing} {row.Name}…");
        try
        {
            await act(row);
            Say($"{row.Name}: done.");
        }
        catch (ControlException e)
        {
            Say($"{row.Name}: {e.Message}", error: true);
        }
        await Refresh();
    }

    private Task StopWorld(WorldRow row)
    {
        if (row.Players > 0 && !Confirm($"{row.Players} player(s) are in {row.Name}. Stop it? The world saves and closes until you start it again.")) return Task.CompletedTask;
        return WorldAction(row, "Saving and stopping", r => _control.StopAsync(r.Id));
    }

    private async Task StartAll()
    {
        foreach (var w in Worlds.Where(w => !w.IsRunning).ToList()) await WorldAction(w, "Starting", r => _control.StartAsync(r.Id));
    }

    private async Task StopAll()
    {
        var playing = Worlds.Sum(w => w.Players);
        if (playing > 0 && !Confirm($"{playing} player(s) are online. Stop every world? Each saves and closes until you start it again.")) return;
        Say("Saving and stopping every world…");
        try
        {
            await _control.StopAllAsync();
            Say("Every world is stopped.");
        }
        catch (ControlException e)
        {
            Say(e.Message, error: true);
        }
        await Refresh();
    }

    /// <summary>check the token with the site, then keep it DPAPI-protected; null when the site said no</summary>
    private async Task<WorldEntry?> CheckWorld(string name, string token, bool autoStart)
    {
        name = name.Trim();
        if (name.Length is 0 or > 32)
        {
            Say("Give the world a name of 1–32 characters (only this app shows it).", error: true);
            return null;
        }
        Say("Checking the token with the site…");
        var result = await _probe.CheckTokenAsync(Site, token);
        if (!result.Ok)
        {
            Say(result.Message, error: true);
            return null;
        }
        Say(result.Message);
        return new WorldEntry { Id = _config.NewWorldId(name), Name = name, TokenProtected = TokenProtector.Protect(token.Trim()), AutoStart = autoStart };
    }

    /// <summary>from the dashboard: check, save, reload the service and (if it auto-starts) start it</summary>
    public async Task AddWorld(string token)
    {
        var world = await CheckWorld(NewWorldName, token, NewWorldAutoStart);
        if (world is null) return;
        var next = _config.WithWorld(world);
        if (!await SaveConfig(next)) return;
        Worlds.Add(new WorldRow(world));
        NewWorldName = "Global world";
        await ReloadService($"{world.Name} added.");
    }

    private async Task RemoveWorld(WorldRow row)
    {
        if (!Confirm($"Remove {row.Name} from this PC? It saves and goes offline; its key stays on the site, so you can add it again later.")) return;
        try
        {
            if (row.IsRunning) await _control.StopAsync(row.Id);
        }
        catch (ControlException e)
        {
            Say(e.Message, error: true);
        }
        if (!await SaveConfig(_config.WithoutWorld(row.Id))) return;
        Worlds.Remove(row);
        await ReloadService($"{row.Name} removed from this PC.");
    }

    private async Task<bool> SaveConfig(HostConfig next)
    {
        var problems = next.Problems();
        if (problems.Count > 0)
        {
            Say(problems[0], error: true);
            return false;
        }
        try
        {
            await Task.Run(() => ConfigStore.Save(_paths.ConfigPath, next));
            _config = next;
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Say($"Could not save the settings ({e.Message}). Run Set up this PC so this account may change them.", error: true);
            return false;
        }
    }

    private async Task ReloadService(string done)
    {
        try
        {
            await _control.ReloadAsync();
            Say(done);
        }
        catch (ControlException e)
        {
            // saved all the same: the service reads it when it next starts
            Say($"{done} The service will pick it up when it runs: {e.Message}");
        }
        await Refresh();
    }

    // ------------------------------------------------------------------ settings

    private HostConfig? SettingsFromForm()
    {
        if (!int.TryParse(FirstPort, out var first) || !int.TryParse(LastPort, out var last))
        {
            Say("The UDP ports must be numbers.", error: true);
            return null;
        }
        return _config with { Site = SiteRules.Normalize(Site), PortRange = [first, last], RelayOnly = RelayOnly };
    }

    private async Task SaveSettings()
    {
        var next = SettingsFromForm();
        if (next is null) return;
        var portsChanged = !next.PortRange.SequenceEqual(_config.PortRange);
        if (!await SaveConfig(next)) return;
        try
        {
            StartupRegistration.Set(StartWithWindows, Environment.ProcessPath!);
        }
        catch (UnauthorizedAccessException e)
        {
            Say($"Saved, but Start with Windows could not be changed: {e.Message}", error: true);
        }
        if (portsChanged && ServiceInstalled)
        {
            Say("The ports changed: Windows asks to update the firewall rule…");
            var result = await Elevation.RunAsync("firewall", "--ports", $"{next.FirstPort}-{next.LastPort}");
            if (result != ElevationResult.Done)
            {
                Say(result == ElevationResult.Declined
                    ? "Saved, but the firewall rule still has the old ports (the prompt was declined)."
                    : $"Saved, but the firewall rule could not be updated; see {Path.Combine(_paths.LogDir, "admin.log")}.", error: true);
                await ReloadService("Settings saved.");
                return;
            }
        }
        await ReloadService("Settings saved.");
        Raise(nameof(PortsHint));
    }

    /// <summary>the admin part, one UAC prompt: data folder, firewall rule, service</summary>
    private async Task<bool> SetUpPc()
    {
        var cfg = SettingsFromForm();
        if (cfg is null) return false;
        Say("Windows asks for permission to set this PC up…");
        var user = $"{Environment.UserDomainName}\\{Environment.UserName}";
        var result = await Elevation.RunAsync("setup", "--user", user, "--ports", $"{cfg.FirstPort}-{cfg.LastPort}");
        switch (result)
        {
            case ElevationResult.Declined:
                Say("Setup needs administrator permission once; nothing was changed.", error: true);
                return false;
            case ElevationResult.Failed:
                Say($"Setup did not finish; see {Path.Combine(_paths.LogDir, "admin.log")}.", error: true);
                await Refresh();
                return false;
        }
        Say("This PC is set up: the firewall allows the ports and the service is running.");
        await Refresh();
        return true;
    }

    // ------------------------------------------------------------------ first run

    /// <summary>the token box's content, handed in by the window (a PasswordBox does not bind)</summary>
    public Func<string> WizardToken { get; set; } = () => "";

    private async Task WizardNext()
    {
        switch (WizardStep)
        {
            case 1:
            {
                var cfg = SettingsFromForm();
                if (cfg is null) return;
                if (!SiteRules.IsAllowed(cfg.Site, out var problem))
                {
                    Say(problem, error: true);
                    return;
                }
                if (cfg.WorldSlots < 1)
                {
                    Say($"The port range must hold at least {HostConfig.PortsPerWorld} ports.", error: true);
                    return;
                }
                Site = cfg.Site;
                Say("");
                WizardStep = 2;
                return;
            }
            case 2:
            {
                _pendingWorld = await CheckWorld(NewWorldName, WizardToken(), autoStart: true);
                if (_pendingWorld is not null) WizardStep = 3;
                return;
            }
            default:
            {
                if (_pendingWorld is null || !await SetUpPc()) return;
                var cfg = SettingsFromForm()!.WithWorld(_pendingWorld);
                if (!await SaveConfig(cfg)) return;
                StartupRegistration.Set(StartWithWindows, Environment.ProcessPath!);
                Worlds.Clear();
                foreach (var w in cfg.Worlds) Worlds.Add(new WorldRow(w));
                IsFirstRun = false;
                await WaitForService();
                await ReloadService($"{_pendingWorld.Name} is starting. Players can enter it once it shows Online.");
                return;
            }
        }
    }

    /// <summary>a service that was just installed needs a moment before it answers</summary>
    private async Task WaitForService()
    {
        var until = DateTime.UtcNow + ServiceWarmUp;
        while (DateTime.UtcNow < until)
        {
            try
            {
                await _control.StatusAsync();
                return;
            }
            catch (ControlException)
            {
                await Task.Delay(500);
            }
        }
    }
}
