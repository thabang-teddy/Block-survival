using BlockSurvivalHost.Core;

namespace BlockSurvivalHost.Services;

/// <summary>
/// `BlockSurvivalHost.exe --admin …`: the steps that need administrator rights, run in a
/// process of their own (started elevated by the app, or by the installer):
///
///   --admin setup --user DOMAIN\name --ports 50000-50199
///   --admin firewall --ports 50000-50199
///   --admin uninstall
///   --admin start          (after an upgrade: start the service if setup installed it)
///
/// What happened goes to logs\admin.log in the data folder; the exit code says whether it worked.
/// </summary>
public static class AdminCommand
{
    public static int Run(IReadOnlyList<string> args, HostPaths paths)
    {
        Directory.CreateDirectory(paths.LogDir);
        var logPath = Path.Combine(paths.LogDir, "admin.log");
        void Log(string line) => File.AppendAllText(logPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}{Environment.NewLine}");

        try
        {
            var verb = args.Count > 0 ? args[0] : "";
            Log($"admin {string.Join(' ', args)}");
            IReadOnlyList<string> failures;
            switch (verb)
            {
                case "setup":
                {
                    var (first, last) = Ports(Option(args, "--ports"));
                    var user = Option(args, "--user") ?? throw new ArgumentException("--user is required");
                    Directory.CreateDirectory(paths.DataDir);
                    File.WriteAllText(paths.ServiceXml, AdminSetup.ServiceXml(paths));
                    failures = AdminSetup.Run(AdminSetup.SetupSteps(paths, user, first, last, AdminSetup.ServiceInstalled()), Log);
                    break;
                }
                case "firewall":
                {
                    var (first, last) = Ports(Option(args, "--ports"));
                    failures = AdminSetup.Run(AdminSetup.FirewallSteps(paths, first, last), Log);
                    break;
                }
                case "uninstall":
                    failures = AdminSetup.Run(AdminSetup.UninstallSteps(paths), Log);
                    break;
                case "start":
                    failures = AdminSetup.ServiceInstalled()
                        ? AdminSetup.Run([new AdminStep("Start the host service", paths.ServiceExe, ["start"])], Log)
                        : [];
                    break;
                default:
                    Log($"unknown admin command \"{verb}\"");
                    return 2;
            }
            foreach (var f in failures) Log($"FAILED: {f}");
            return failures.Count == 0 ? 0 : 1;
        }
        catch (Exception e)
        {
            Log($"FAILED: {e.Message}");
            return 1;
        }
    }

    private static string? Option(IReadOnlyList<string> args, string name)
    {
        for (var i = 0; i < args.Count - 1; i++)
        {
            if (args[i] == name) return args[i + 1];
        }
        return null;
    }

    internal static (int First, int Last) Ports(string? range)
    {
        var parts = (range ?? "").Split('-');
        if (parts.Length == 2 && int.TryParse(parts[0], out var first) && int.TryParse(parts[1], out var last)
            && first >= 1024 && last <= 65535 && first <= last)
        {
            return (first, last);
        }
        throw new ArgumentException($"--ports must be first-last between 1024 and 65535, not \"{range}\"");
    }
}
