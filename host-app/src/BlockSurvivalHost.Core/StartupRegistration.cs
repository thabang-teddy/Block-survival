using Microsoft.Win32;

namespace BlockSurvivalHost.Core;

/// <summary>
/// "Start with Windows" for the app itself (the service always starts with Windows):
/// a Run entry for the signed-in owner that opens the app in the tray.
/// </summary>
public static class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "BlockSurvivalHost";

    public static string Command(string exePath) => $"\"{exePath}\" --tray";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string;
    }

    public static void Set(bool enabled, string exePath)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled) key.SetValue(ValueName, Command(exePath));
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
