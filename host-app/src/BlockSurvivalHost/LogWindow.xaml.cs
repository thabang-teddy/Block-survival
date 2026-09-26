using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using BlockSurvivalHost.Core;
using BlockSurvivalHost.ViewModels;

namespace BlockSurvivalHost;

/// <summary>the tail of one world's log, read through the service and refreshed every few seconds</summary>
public partial class LogWindow : Window
{
    private readonly WorldRow _row;
    private readonly MainViewModel _vm;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(3) };

    public LogWindow(WorldRow row, MainViewModel vm)
    {
        InitializeComponent();
        _row = row;
        _vm = vm;
        Title = $"{row.Name} — log";
        Heading.Text = $"{row.Name} log";
        _timer.Tick += async (_, _) => await Load();
        Loaded += async (_, _) =>
        {
            await Load();
            _timer.Start();
        };
        Closed += (_, _) => _timer.Stop();
    }

    private async Task Load()
    {
        try
        {
            var lines = await _vm.LogAsync(_row.Id);
            Lines.Text = string.Join(Environment.NewLine, lines.Select(Format));
            Status.Text = $"{lines.Count} lines · {DateTime.Now:T}";
            if (Follow.IsChecked == true) Lines.ScrollToEnd();
        }
        catch (ControlException e)
        {
            Status.Text = e.Message;
        }
    }

    /// <summary>a JSON log line as "time  level  message  key=value…"</summary>
    internal static string Format(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            var time = root.TryGetProperty("t", out var t) && DateTime.TryParse(t.GetString(), out var at) ? at.ToLocalTime().ToString("dd MMM HH:mm:ss") : "";
            var level = root.TryGetProperty("level", out var l) ? l.GetString() : "";
            var msg = root.TryGetProperty("msg", out var m) ? m.GetString() : "";
            var extra = root.EnumerateObject()
                .Where(p => p.Name is not ("t" or "level" or "msg"))
                .Select(p => $"{p.Name}={(p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.GetRawText())}");
            return $"{time}  {(level == "error" ? "ERROR" : "info ")}  {msg}  {string.Join("  ", extra)}".TrimEnd();
        }
        catch (JsonException)
        {
            return line;
        }
    }

    private async void OnRefresh(object sender, RoutedEventArgs e) => await Load();

    private void OnCopy(object sender, RoutedEventArgs e) => Clipboard.SetText(Lines.Text);
}
