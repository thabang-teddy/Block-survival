namespace BlockSurvivalHost.Core;

/// <summary>
/// Where things live. The app and pc-host are installed under Program Files; what the
/// service reads and writes (config.json, control.key, logs) lives in the data folder,
/// %ProgramData%\BlockSurvivalHost, so upgrades never touch it.
/// </summary>
public sealed record HostPaths(string InstallDir, string DataDir)
{
    public const string ServiceName = "block-survival-pc-host";

    /// <summary>overrides the data folder (tests, a dev checkout)</summary>
    public const string DataDirVariable = "BSH_DATA_DIR";

    /// <summary>overrides where pc-host is (a dev build uses the repo's pc-host\ instead of one next to the exe)</summary>
    public const string PcHostDirVariable = "BSH_PCHOST_DIR";

    /// <summary>pc-host's folder: next to the app when installed</summary>
    public string PcHostDir { get; init; } = Path.Combine(InstallDir, "pc-host");
    public string NodeExe => Path.Combine(PcHostDir, "node.exe");
    public string ServiceExe => Path.Combine(PcHostDir, "pc-host-service.exe");
    public string ServiceXml => Path.Combine(PcHostDir, "pc-host-service.xml");
    public string ConfigPath => Path.Combine(DataDir, "config.json");
    public string KeyPath => Path.Combine(DataDir, "control.key");
    public string LogDir => Path.Combine(DataDir, "logs");

    public static HostPaths Default()
    {
        var data = Environment.GetEnvironmentVariable(DataDirVariable);
        if (string.IsNullOrWhiteSpace(data))
        {
            data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "BlockSurvivalHost");
        }
        var install = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var pcHost = Environment.GetEnvironmentVariable(PcHostDirVariable);
        return string.IsNullOrWhiteSpace(pcHost)
            ? new HostPaths(install, data)
            : new HostPaths(install, data) { PcHostDir = Path.GetFullPath(pcHost) };
    }
}
