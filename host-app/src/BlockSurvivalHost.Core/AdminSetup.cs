using System.Diagnostics;
using System.Security;
using System.ServiceProcess;
using Microsoft.Win32;

namespace BlockSurvivalHost.Core;

public enum ServiceKind
{
    /// <summary>not installed</summary>
    None,

    /// <summary>installed from this app's folder</summary>
    Ours,

    /// <summary>a service of the same name from another folder (a hand-made pc-host service)</summary>
    Foreign,
}

public sealed record ServiceRegistration(ServiceKind Kind, string? ExePath);

/// <summary>one program run by an admin step; a step that may fail (removing what is not there) says so</summary>
public sealed record AdminStep(string Description, string FileName, IReadOnlyList<string> Args, bool MayFail = false);

/// <summary>
/// What needs administrator rights, and only that: the data folder's permissions, the
/// firewall rule for the UDP ports, and the Windows service (WinSW running
/// `pc-host service`). The app runs itself elevated (`--admin setup`, one UAC prompt)
/// for these; everything else — config, start and stop — runs as the owner.
/// </summary>
public static class AdminSetup
{
    public const string FirewallRule = "Block Survival Host (UDP)";

    /// <summary>LocalSystem and BUILTIN\Administrators by SID, so icacls works in any Windows language</summary>
    private const string SystemSid = "*S-1-5-18";
    private const string AdministratorsSid = "*S-1-5-32-544";

    /// <summary>the WinSW service definition: pc-host's supervisor, with its data in ProgramData</summary>
    public static string ServiceXml(HostPaths paths) => $"""
        <!-- Written by the Block Survival Host app (docs/pc-host-research.md §8). -->
        <service>
          <id>{HostPaths.ServiceName}</id>
          <name>Block Survival PC host</name>
          <description>Hosts Block Survival global worlds for the site.</description>
          <executable>%BASE%\node.exe</executable>
          <arguments>"%BASE%\dist\pc-host.mjs" service</arguments>
          <workingdirectory>%BASE%</workingdirectory>
          <env name="PC_HOST_HOME" value="{SecurityElement.Escape(paths.DataDir)}"/>
          <startmode>Automatic</startmode>
          <delayedAutoStart>true</delayedAutoStart>
          <onfailure action="restart" delay="10 sec"/>
          <onfailure action="restart" delay="30 sec"/>
          <onfailure action="restart" delay="2 min"/>
          <resetfailure>1 hour</resetfailure>
          <stoptimeout>30 sec</stoptimeout>
          <logpath>{SecurityElement.Escape(paths.LogDir)}</logpath>
          <log mode="roll-by-size">
            <sizeThreshold>5120</sizeThreshold>
            <keepFiles>3</keepFiles>
          </log>
        </service>
        """;

    public static IReadOnlyList<AdminStep> FirewallSteps(HostPaths paths, int firstPort, int lastPort) =>
    [
        new("Remove the old firewall rule", "netsh", ["advfirewall", "firewall", "delete", "rule", $"name={FirewallRule}"], MayFail: true),
        new($"Allow UDP {firstPort}–{lastPort} for the host", "netsh",
        [
            "advfirewall", "firewall", "add", "rule", $"name={FirewallRule}", "dir=in", "action=allow",
            $"program={paths.NodeExe}", "protocol=UDP", $"localport={firstPort}-{lastPort}", "profile=any", "enable=yes",
        ]),
    ];

    /// <summary>
    /// Set the PC up: the owner may edit the data folder (so the app needs no admin rights
    /// afterwards) and no other account may read it, the firewall allows the ports, and
    /// the service is installed and running. A service of the same name registered from
    /// another folder (a hand-made pc-host service, an older install) is stopped and
    /// removed first: it would read another config and write its key elsewhere.
    /// </summary>
    public static IReadOnlyList<AdminStep> SetupSteps(HostPaths paths, string user, int firstPort, int lastPort, ServiceRegistration service)
    {
        var steps = new List<AdminStep>
        {
            // only SYSTEM (the service), Administrators and the owner: control.key in here stops every world
            new($"Let only {user}, administrators and the service use the host's settings", "icacls",
                [paths.DataDir, "/inheritance:r", "/grant:r", $"{SystemSid}:(OI)(CI)F", "/grant:r", $"{AdministratorsSid}:(OI)(CI)F", "/grant:r", $"{user}:(OI)(CI)M"]),
        };
        steps.AddRange(FirewallSteps(paths, firstPort, lastPort));
        switch (service.Kind)
        {
            case ServiceKind.Ours:
                // WinSW reads the service definition each time it starts: a stop and a start pick up a new one
                steps.Add(new("Stop the host service", paths.ServiceExe, ["stopwait"], MayFail: true));
                break;
            case ServiceKind.Foreign:
                steps.AddRange(RemoveForeignSteps(service.ExePath));
                steps.Add(new("Install the host service", paths.ServiceExe, ["install"]));
                break;
            default:
                steps.Add(new("Install the host service", paths.ServiceExe, ["install"]));
                break;
        }
        steps.Add(new("Start the host service", paths.ServiceExe, ["start"]));
        return steps;
    }

    /// <summary>take down a same-named service from another folder, with its own WinSW when it is still there</summary>
    private static IEnumerable<AdminStep> RemoveForeignSteps(string? exe)
    {
        if (exe is not null && File.Exists(exe))
        {
            yield return new($"Stop the host service registered from {Path.GetDirectoryName(exe)}", exe, ["stopwait"], MayFail: true);
            yield return new("Remove that service", exe, ["uninstall"]);
        }
        else
        {
            yield return new("Stop the old host service", "sc.exe", ["stop", HostPaths.ServiceName], MayFail: true);
            yield return new("Remove the old host service", "sc.exe", ["delete", HostPaths.ServiceName]);
        }
    }

    /// <summary>is the service installed, and from this app's folder?</summary>
    public static ServiceRegistration Registration(HostPaths paths)
    {
        using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{HostPaths.ServiceName}");
        if (key?.GetValue("ImagePath") is not string image) return new ServiceRegistration(ServiceKind.None, null);
        var exe = ExeOf(image);
        return new ServiceRegistration(SamePath(exe, paths.ServiceExe) ? ServiceKind.Ours : ServiceKind.Foreign, exe);
    }

    internal static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);

    /// <summary>the program of a service's command line: quoted, or up to the ".exe"</summary>
    internal static string ExeOf(string imagePath)
    {
        var s = Environment.ExpandEnvironmentVariables(imagePath.Trim());
        if (s.StartsWith('"'))
        {
            var end = s.IndexOf('"', 1);
            return end > 0 ? s[1..end] : s.Trim('"');
        }
        var exeEnd = s.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        return exeEnd > 0 ? s[..(exeEnd + 4)] : s.Split(' ')[0];
    }

    /// <summary>
    /// Undo it all (the installer runs this when the app is removed). Only this app's own
    /// service goes: one registered from another folder is not ours to remove.
    /// </summary>
    public static IReadOnlyList<AdminStep> UninstallSteps(HostPaths paths, ServiceKind service)
    {
        var steps = new List<AdminStep>();
        if (service == ServiceKind.Ours)
        {
            steps.Add(new("Stop the host service", paths.ServiceExe, ["stop"], MayFail: true));
            steps.Add(new("Remove the host service", paths.ServiceExe, ["uninstall"], MayFail: true));
        }
        steps.Add(new("Remove the firewall rule", "netsh", ["advfirewall", "firewall", "delete", "rule", $"name={FirewallRule}"], MayFail: true));
        return steps;
    }

    public static bool ServiceInstalled() =>
        ServiceController.GetServices().Any(s => string.Equals(s.ServiceName, HostPaths.ServiceName, StringComparison.OrdinalIgnoreCase));

    /// <summary>the service's state, or null when it is not installed</summary>
    public static ServiceControllerStatus? ServiceState()
    {
        try
        {
            using var sc = new ServiceController(HostPaths.ServiceName);
            return sc.Status;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    /// <summary>run the steps in order; returns what failed (a step that may fail never counts)</summary>
    public static IReadOnlyList<string> Run(IEnumerable<AdminStep> steps, Action<string> log)
    {
        var failures = new List<string>();
        foreach (var step in steps)
        {
            log($"> {step.Description}");
            var psi = new ProcessStartInfo(step.FileName)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var a in step.Args) psi.ArgumentList.Add(a);
            try
            {
                using var p = Process.Start(psi)!;
                var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (output.Trim().Length > 0) log(output.Trim());
                if (p.ExitCode != 0 && !step.MayFail)
                {
                    failures.Add($"{step.Description} (exit code {p.ExitCode})");
                    break;
                }
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
            {
                if (!step.MayFail)
                {
                    failures.Add($"{step.Description}: {e.Message}");
                    break;
                }
            }
        }
        return failures;
    }
}
