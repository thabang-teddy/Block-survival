# pc-host — global worlds, hosted on a PC at home

The design is in [`docs/pc-host-research.md`](../docs/pc-host-research.md) (§8 for
many worlds). In short: this app runs the authoritative simulation of Block Survival's
global worlds on a Windows PC. The Laravel site stays the front door (accounts, device
approval, the login window). Players reach the PC over the same WebRTC path they use
between browsers: the site's signalling mailbox, then a direct DataChannel. The PC
needs no domain, certificate or open TCP port.

Each **host key** made on the site (Admin → Host PCs) is one global world with its own
map, save and players. One PC can run several: `pc-host service` runs one worker
process per world, so one world crashing never touches the others.

- **Online:** the PC runs the world; players pick it from the lobby and join it.
- **Paused:** the PC went quiet (crash, power cut, lost connection, sleep, or Windows
  restarting the service). The world waits for it **for as long as it takes**, and
  players rejoin by themselves when it is back.
- **Offline:** the world was stopped, marked offline by the admin, or its key is
  disabled. Nobody can enter it until its PC runs it again — browsers never host a
  global world.

## Set up — the usual way: the Block Survival Host app

Install `BlockSurvivalHost-<version>.msi` (built by [`host-app/build.ps1`](../host-app/README.md))
and open *Block Survival Host*. Its wizard asks for the site, a UDP port range and the
first world's host token (it checks the token with the site), then asks Windows once
for administrator rights to add the firewall rule and install the service. From then
on the app starts, stops and restarts each world, adds and removes worlds and shows
their logs. Config and logs live in `%ProgramData%\BlockSurvivalHost`.

**TURN (recommended):** create a Cloudflare Realtime TURN key and put it in the site's
`.env` as `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN`. Without it,
players whose networks block direct UDP cannot connect.

## Set up — by hand (the dev PC)

1. **Create host keys on the site:** Admin → Host PCs → *Create host key*. Copy each
   token now; it is shown only once.
2. **Build it** (Node 24):

   ```bash
   cd server && npm ci        # the game code the PC imports lives here
   cd ../pc-host && npm ci && npm run build
   ```

   The service runs straight from this folder: `dist\pc-host.mjs`, with `node_modules`
   next to it for node-datachannel's native module. Copy the Node you built with into
   the folder as `node.exe` (gitignored). `npm run package` assembles `release\pc-host\`
   instead: the same files with `node.exe` included, ready to copy to another PC.
3. **Configure:** `config.json` (gitignored) next to this README:

   ```json
   {
     "site": "https://your-site.example",
     "portRange": [50000, 50199],
     "relayOnly": false,
     "controlPort": 47810,
     "worlds": [
       { "id": "home", "name": "Home", "token": "first host token" },
       { "id": "attic", "name": "Attic", "token": "second host token", "autoStart": false }
     ]
   }
   ```

   | key | |
   |---|---|
   | `site` | the site's `https://` address (plain `http` only for localhost or a `.test` dev site) |
   | `portRange` | UDP ports WebRTC may use; each world takes 20 of them, in order. Forwarding them on the router is optional |
   | `relayOnly` | `true` sends all traffic through TURN, so players never see the PC's IP. Costs a little latency |
   | `controlPort` | the control API's port on 127.0.0.1 (for the host app) |
   | `worlds[].token` / `tokenProtected` | the host token, plain or DPAPI-protected in machine scope (the app writes the latter) |
   | `worlds[].autoStart` | start with the service (default `true`) |

   A single-world `config.json` from before (`site` + `token` at the top) still works.
4. **Try one world in a window:** `pc-host.cmd` runs `run` against a single-world
   config. When Windows Firewall asks, allow `node.exe` (UDP only is enough).
5. **Run the service:** download `WinSW-x64.exe` (v2.12) from the WinSW GitHub
   releases, put it next to `pc-host-service.xml` renamed `pc-host-service.exe`
   (gitignored), and from an administrator prompt:

   ```bat
   pc-host-service.exe install
   pc-host-service.exe start
   ```

   It runs `pc-host service`, starts with Windows and restarts after a crash. Its
   control key is written to `control.key` here.

## Everyday use

- **Updates, reboots, shutting down:** Windows stops the service; every world saves and
  its players wait on the pause screen until the PC is back.
- **Going away for a while:** stop the worlds in the app (or `POST /stop-all`, below).
  Each saves and goes offline; the lobby shows it greyed out.
- **The PC died while you were away:** press *Mark offline* for that world on the site's
  Host PCs page (it works from a phone). Its waiting players go back to the lobby.
- **Logs:** `logs\service.log` is the supervisor's; `logs\<world id>\pc-host.log` each
  world's (starts, stops, freezes, connection problems). The site's Host PCs page shows
  each world's last heartbeat, version and players.

### The control API

The host app uses it; anything on the PC holding `control.key` can too:

```bash
curl -H "Authorization: Bearer $(cat control.key)" http://127.0.0.1:47810/status
```

`GET /status`, `POST /worlds/<id>/start|stop|restart`, `POST /stop-all`, `POST /reload`
(re-read `config.json`), `GET /worlds/<id>/log?lines=200`. Stop means offline; restart
keeps the players paused. It listens on 127.0.0.1 only and refuses requests addressed
to any other host name.

## Develop

```bash
npm test          # Vitest: sim, room, config, supervisor, control API, real WebRTC between node-datachannel peers
npm run typecheck
npm run build     # dist/pc-host.mjs (esbuild; node-datachannel stays external)
```

The game code is not copied. `@game/*` resolves to `server/resources/js/*` (see
`aliases.mjs`), so `server/` must have its `node_modules` installed. The web client's
model loader is swapped for a headless stub (`src/headless/assets.ts`).

To try it against a local site, run the service with `PC_HOST_HOME` pointing at a
folder holding a `config.json` with `"site": "http://localhost:8000"` or a Herd site
such as `"http://block-survival.test"`. Plain `http` is only accepted for localhost,
127.0.0.1 and `.test` hostnames.
