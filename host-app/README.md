# host-app — Block Survival Host for Windows

The desktop app that sets a PC up to host Block Survival's global worlds and runs them
(docs/pc-host-research.md §8). It is a .NET 10 WPF app with a tray icon, on top of
[`pc-host`](pc-host/README.md) (in `host-app/pc-host/`): the app never runs a world itself; the Windows
service (`pc-host service`, wrapped by WinSW) does, and the app drives it through its
control API on 127.0.0.1.

| | |
|---|---|
| `src/BlockSurvivalHost.Core` | config.json (the same schema pc-host reads), DPAPI token protection, the site's token check, the control API client, the admin steps (firewall, folder permissions, service) |
| `src/BlockSurvivalHost` | the WPF app: first-run wizard, dashboard, log window, tray; `--admin …` runs one elevated step headless |
| `tests/BlockSurvivalHost.Core.Tests` | xUnit |
| `installer/` | WiX 5 MSI |
| `build.ps1` | builds pc-host and the app, stages them, builds the MSI, signs if configured |

## What the owner sees

1. **Install** `BlockSurvivalHost-<version>.msi`: the app and pc-host (with Node and
   WinSW) go to `C:\Program Files\Block Survival Host`, with Start Menu and desktop
   shortcuts. Config and logs live in `%ProgramData%\BlockSurvivalHost` and survive
   upgrades and removal.
2. **First run:** the site's address and a UDP port range (20 ports per world); the
   first world's host token from the site (Admin → Host PCs), checked against the site
   before it is saved; then *Set up this PC* — one UAC prompt that lets the owner's
   account change the data folder, adds a UDP-only firewall rule for the range and
   installs and starts the service.
3. **Every day:** each world with Start, Stop (saves; the world goes offline), Restart
   (players stay paused), Log and Remove; Start all / Stop all; add a world by pasting
   another token; settings (site, ports — a change asks for UAC once more to update the
   firewall rule — relay-only, open in the tray at sign-in). Closing the window keeps
   the app in the tray; the worlds keep running either way.
4. **Uninstall** stops and removes the service and the firewall rule.

## Build

```powershell
.\build.ps1 -Version 1.0.0
```

It needs Node 24 and npm (for pc-host), the .NET 10 SDK, and WinSW-x64.exe v2.12
(defaults to `pc-host\pc-host-service.exe`; pass `-WinSW <path>` otherwise). NuGet
fetches WiX 5 on the first build. Output: `out\BlockSurvivalHost-<version>.msi`, about
100 MB — the app is self-contained, so the PC needs no .NET install.

### Signing (needed before anyone else installs it)

Windows **Smart App Control** blocks unsigned apps outright, and SmartScreen warns about
unsigned installers. Signing needs a code-signing certificate — for example **Azure
Trusted Signing** (a monthly subscription, identity-validated) or an OV/EV certificate
from a CA — and `signtool.exe` from the Windows SDK. Then either:

- `$env:BSH_SIGN_THUMBPRINT = "<thumbprint>"` for a certificate in your store, or
- `$env:BSH_SIGN_ARGS = "sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib <path>\Azure.CodeSigning.Dlib.dll /dmdf <path>\metadata.json"` for Trusted Signing,

and run `build.ps1` again: it signs the app's exe and the MSI. Without either it builds
unsigned and says so. There is no way around Smart App Control short of signing.

## Develop (no install, no admin)

The app drives whatever answers on the control port, so in development run
`pc-host service` yourself and point the app at the same folder:

1. **A data folder** (e.g. `C:\bsh-dev`) with a `config.json` — the same schema as
   [pc-host's](pc-host/README.md#set-up--by-hand-the-dev-pc). Plain `token`s are fine
   here; give it its own `controlPort` (e.g. `47899`) so it never meets an installed copy:

   ```json
   {
     "site": "http://block-survival.test",
     "portRange": [51000, 51059],
     "controlPort": 47899,
     "worlds": [{ "id": "home", "name": "Home", "token": "a host token from Admin -> Host PCs" }]
   }
   ```

2. **Run pc-host** (after `npm run build` in `host-app/pc-host/`):

   ```powershell
   cd pc-host
   $env:PC_HOST_HOME = "C:\bsh-dev"; node dist\pc-host.mjs service
   ```

3. **Run the app** in another terminal:

   ```powershell
   $env:BSH_DATA_DIR = "C:\bsh-dev"
   $env:BSH_PCHOST_DIR = "C:\Users\Teddy\projects\Block survival\host-app\pc-host"
   dotnet run --project src\BlockSurvivalHost
   ```

The header then says *pc-host … is running (not as this app's service)*, and start,
stop, restart, logs, adding and removing worlds all work. One copy of the app runs per
data folder, so this runs beside an installed one. Stopping the `node` process (Ctrl+C)
pauses the worlds, as a service stop would.

**Set up this PC / Repair setup** in a dev copy works too (one UAC prompt): it installs
the Windows service from the repo's `host-app\pc-host\` (`BSH_PCHOST_DIR`) with its data in
`BSH_DATA_DIR`, so the worlds run without the MSI and start with Windows. Stop the
hand-run `node` first. If the MSI is installed as well, the two share one service name:
whichever ran setup last owns it, and the other offers to take it back.

```bash
dotnet test                       # Core: config, DPAPI, site check, control client, admin steps
```

Freshly built unsigned binaries (the app, the test DLL) can be blocked by Smart App
Control ("an Application Control policy has blocked this file"); allow them when it asks.
