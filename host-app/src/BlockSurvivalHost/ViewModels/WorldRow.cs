using BlockSurvivalHost.Core;
using BlockSurvivalHost.Infrastructure;

namespace BlockSurvivalHost.ViewModels;

/// <summary>one world on the dashboard: what config.json says about it, plus what the service reports</summary>
public sealed class WorldRow(WorldEntry entry) : Observable
{
    private WorldEntry _entry = entry;
    private string _phase = "stopped";
    private int _players;
    private string? _code;
    private int _restarts;
    private string? _error;

    public WorldEntry Entry
    {
        get => _entry;
        set
        {
            _entry = value;
            Raise(nameof(Name));
            Raise(nameof(Id));
        }
    }

    public string Id => _entry.Id;
    public string Name => _entry.Name;

    public string Phase
    {
        get => _phase;
        private set
        {
            if (!Set(ref _phase, value)) return;
            Raise(nameof(PhaseText));
            Raise(nameof(IsRunning));
        }
    }

    public int Players { get => _players; private set { if (Set(ref _players, value)) Raise(nameof(Detail)); } }

    public string? Code { get => _code; private set { if (Set(ref _code, value)) Raise(nameof(Detail)); } }

    public int Restarts { get => _restarts; private set { if (Set(ref _restarts, value)) Raise(nameof(Detail)); } }

    public string? Error { get => _error; private set { if (Set(ref _error, value)) Raise(nameof(HasError)); } }

    public bool HasError => !string.IsNullOrEmpty(_error);

    /// <summary>a worker is up (or on its way up / down): Start is pointless, Stop is not</summary>
    public bool IsRunning => _phase is "starting" or "online" or "frozen" or "stopping";

    public string PhaseText => _phase switch
    {
        "online" => "Online",
        "frozen" => "Frozen — the site can't be reached",
        "starting" => "Starting…",
        "stopping" => "Saving and stopping…",
        "crashed" => "Crashed — restarting",
        "revoked" => "Token refused",
        "error" => "Can't start",
        "unknown" => "Service not running",
        _ => "Stopped",
    };

    public string Detail
    {
        get
        {
            var parts = new List<string>();
            if (IsRunning) parts.Add($"{_players}/4 playing");
            if (_code is not null) parts.Add($"room {_code}");
            if (_restarts > 0) parts.Add($"{_restarts} restart{(_restarts == 1 ? "" : "s")}");
            parts.Add(_entry.AutoStart ? "starts with the service" : "manual start");
            return string.Join(" · ", parts);
        }
    }

    public void Apply(WorldStatus? status)
    {
        Phase = status?.Phase ?? "stopped";
        Players = status?.Players ?? 0;
        Code = status?.Code;
        Restarts = status?.Restarts ?? 0;
        Error = status?.Error;
    }

    /// <summary>the service cannot be asked: nothing is known about the world</summary>
    public void ApplyUnknown()
    {
        Phase = "unknown";
        Players = 0;
        Code = null;
        Error = null;
    }
}
