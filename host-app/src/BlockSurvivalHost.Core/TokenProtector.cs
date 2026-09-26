using System.Security.Cryptography;
using System.Text;

namespace BlockSurvivalHost.Core;

/// <summary>
/// Host tokens are stored with Windows DPAPI in machine scope: the service (LocalSystem)
/// can read what the owner's app wrote, and a copy of config.json is useless on any
/// other PC. pc-host decrypts it the same way (pc-host/src/supervisor/dpapi.ts).
/// </summary>
public static class TokenProtector
{
    public static string Protect(string token)
    {
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), optionalEntropy: null, DataProtectionScope.LocalMachine);
        return Convert.ToBase64String(bytes);
    }

    public static string Unprotect(string protectedToken)
    {
        var bytes = ProtectedData.Unprotect(Convert.FromBase64String(protectedToken), optionalEntropy: null, DataProtectionScope.LocalMachine);
        return Encoding.UTF8.GetString(bytes);
    }
}
