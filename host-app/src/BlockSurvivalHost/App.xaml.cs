using System.Drawing;
using System.Windows;
using BlockSurvivalHost.Core;
using BlockSurvivalHost.Services;
using BlockSurvivalHost.ViewModels;
using Forms = System.Windows.Forms;

namespace BlockSurvivalHost;

/// <summary>
/// Block Survival Host. Started plainly it shows the dashboard (or the first-run
/// wizard); `--tray` starts it in the tray (Start with Windows); `--admin …` runs one
/// elevated setup step and exits without a window. One copy runs per data folder: a
/// second start brings the first one's window up. Closing the window keeps it in the tray — the
/// worlds are run by the service either way.
/// </summary>
public partial class App : System.Windows.Application
{
    private const string InstanceName = "BlockSurvivalHost.App";
    private Mutex? _instance;
    private EventWaitHandle? _showSignal;
    private Forms.NotifyIcon? _tray;
    private MainWindow? _window;
    private MainViewModel? _vm;
    private bool _exiting;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var paths = HostPaths.Default();
        if (e.Args.Length > 0 && e.Args[0] == "--admin")
        {
            Shutdown(AdminCommand.Run(e.Args.Skip(1).ToList(), paths));
            return;
        }

        // one copy per data folder: a dev copy with its own BSH_DATA_DIR runs beside the installed one
        var name = $"{InstanceName}.{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(paths.DataDir.ToLowerInvariant())))[..16]}";
        _instance = new Mutex(initiallyOwned: true, $@"Local\{name}", out var first);
        _showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, $@"Local\{name}.Show");
        if (!first)
        {
            _showSignal.Set();
            Shutdown(0);
            return;
        }
        ThreadPool.RegisterWaitForSingleObject(_showSignal, (_, _) => Dispatcher.Invoke(ShowWindow), null, Timeout.Infinite, executeOnlyOnce: false);

        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
        var probeHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        _vm = new MainViewModel(paths, new ControlClient(http, paths, () => ControlPort(paths)), new SiteProbe(probeHttp));
        _window = new MainWindow(_vm);
        _window.Closing += (_, args) =>
        {
            if (_exiting) return;
            args.Cancel = true;
            _window.Hide();
        };
        CreateTray();
        if (!e.Args.Contains("--tray")) ShowWindow();
    }

    /// <summary>the control port from config.json (the default until one is saved)</summary>
    private static int ControlPort(HostPaths paths)
    {
        try
        {
            return ConfigStore.Load(paths.ConfigPath)?.ControlPort ?? HostConfig.DefaultControlPort;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            return HostConfig.DefaultControlPort;
        }
    }

    private void CreateTray()
    {
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Open Block Survival Host", null, (_, _) => ShowWindow());
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Start every world", null, (_, _) => _vm!.StartAllCommand.Execute(null));
        menu.Items.Add("Stop every world", null, (_, _) =>
        {
            ShowWindow();
            _vm!.StopAllCommand.Execute(null);
        });
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Exit (the worlds keep running)", null, (_, _) => ExitApp());
        _tray = new Forms.NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? SystemIcons.Application,
            Text = "Block Survival Host",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => ShowWindow();
    }

    private void ShowWindow()
    {
        if (_window is null) return;
        _window.Show();
        if (_window.WindowState == WindowState.Minimized) _window.WindowState = WindowState.Normal;
        _window.Activate();
    }

    private void ExitApp()
    {
        _exiting = true;
        _tray?.Dispose();
        _window?.Close();
        Shutdown(0);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        _instance?.Dispose();
        _showSignal?.Dispose();
        base.OnExit(e);
    }
}
