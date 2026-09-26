using System.ComponentModel;
using System.Diagnostics;
using BlockSurvivalHost.Core;

namespace BlockSurvivalHost.Services;

/// <summary>
/// Runs this app again as administrator for one `--admin` step (a UAC prompt), and
/// waits for it. Only the steps in <see cref="AdminCommand"/> run this way. Windows
/// starts the elevated process with a fresh environment, so the folders this copy uses
/// (BSH_DATA_DIR / BSH_PCHOST_DIR in development) travel on its command line.
/// </summary>
public static class Elevation
{
    /// <summary>ERROR_CANCELLED: the owner said no at the UAC prompt</summary>
    private const int Cancelled = 1223;

    public static async Task<ElevationResult> RunAsync(HostPaths paths, params string[] args)
    {
        var psi = new ProcessStartInfo(Environment.ProcessPath!)
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        psi.ArgumentList.Add("--admin");
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.ArgumentList.Add(AdminCommand.DataDirOption);
        psi.ArgumentList.Add(paths.DataDir);
        psi.ArgumentList.Add(AdminCommand.PcHostDirOption);
        psi.ArgumentList.Add(paths.PcHostDir);
        try
        {
            using var p = Process.Start(psi)!;
            await p.WaitForExitAsync();
            return p.ExitCode == 0 ? ElevationResult.Done : ElevationResult.Failed;
        }
        catch (Win32Exception e) when (e.NativeErrorCode == Cancelled)
        {
            return ElevationResult.Declined;
        }
    }
}

public enum ElevationResult
{
    Done,
    Failed,
    Declined,
}
