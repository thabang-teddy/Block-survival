using System.Diagnostics;
using System.Security;
using System.ServiceProcess;

namespace BlockSurvivalHost.Core;

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
    /// the service is installed and running.
    /// </summary>
    public static IReadOnlyList<AdminStep> SetupSteps(HostPaths paths, string user, int firstPort, int lastPort, bool serviceInstalled)
    {
        var steps = new List<AdminStep>
        {
            // only SYSTEM (the service), Administrators and the owner: control.key in here stops every world
            new($"Let only {user}, administrators and the service use the host's settings", "icacls",
                [paths.DataDir, "/inheritance:r", "/grant:r", $"{SystemSid}:(OI)(CI)F", "/grant:r", $"{AdministratorsSid}:(OI)(CI)F", "/grant:r", $"{user}:(OI)(CI)M"]),
        };
        steps.AddRange(FirewallSteps(paths, firstPort, lastPort));
        if (serviceInstalled)
        {
            // WinSW reads the service definition each time it starts: a stop and a start pick up a new one
            steps.Add(new("Stop the host service", paths.ServiceExe, ["stopwait"], MayFail: true));
        }
        else
        {
            steps.Add(new("Install the host service", paths.ServiceExe, ["install"]));
        }
        steps.Add(new("Start the host service", paths.ServiceExe, ["start"]));
        return steps;
    }

    /// <summary>undo it all (the installer runs this when the app is removed)</summary>
    public static IReadOnlyList<AdminStep> UninstallSteps(HostPaths paths) =>
    [
        new("Stop the host service", paths.ServiceExe, ["stop"], MayFail: true),
        new("Remove the host service", paths.ServiceExe, ["uninstall"], MayFail: true),
        new("Remove the firewall rule", "netsh", ["advfirewall", "firewall", "delete", "rule", $"name={FirewallRule}"], MayFail: true),
    ];

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
