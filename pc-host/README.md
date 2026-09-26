# pc-host — the global world, hosted on a PC at home

The design is in [`docs/pc-host-research.md`](../docs/pc-host-research.md). In short:
this app runs the global world's authoritative simulation on a Windows PC. The
Laravel site stays the front door (accounts, device approval, the login window).
Players reach the PC over the same WebRTC path they already use between browsers:
the site's signalling mailbox, then a direct DataChannel. The PC needs no domain,
certificate or open TCP port.

- **Online:** the PC hosts the global world. Players' own worlds are still hosted in
  their browsers.
- **Paused:** the PC went quiet (crash, power cut, lost connection, sleep, or Windows
  restarting the service). The world waits for it **for as long as it takes**, and
  players rejoin by themselves when it is back.
- **Offline:** `pc-host offline`, the admin's **Release to browsers** button, or no
  host PC set up. The browsers host the world, as they did before the PC. A PC that
  comes back takes the world back when the browsers' room closes or nobody is in it.

## Set up

1. **Create the host on the site.** Admin → Overview → *Host PC* → name it → *Create
   host PC*. Copy the token now; it is shown only once. *New token* rotates it, and
   *Remove* revokes it.
2. **TURN (recommended).** Create a Cloudflare Realtime TURN key and put it in the
   site's `.env` as `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN`.
   Without it, players whose networks block direct UDP cannot connect.
3. **Build it** (Node 24):

   ```bash
   cd server && npm ci        # the game code the PC imports lives here
   cd ../pc-host && npm ci && npm run build
   ```

   The service runs straight from this `pc-host\` folder: `dist\pc-host.mjs`, with
   `node_modules` next to it for node-datachannel's native module. Copy the Node you
   built with into the folder as `node.exe` (gitignored), so the service does not
   depend on whichever Node is on the PATH:

   ```bat
   copy "C:\nvm4w\nodejs\node.exe" node.exe
   ```

   To host from another PC instead, `npm run package` assembles `release\pc-host\`:
   the same files with `node.exe` included, ready to copy.
4. **Configure:** copy `config.example.json` to `config.json` (gitignored) and fill
   it in:

   | key | |
   |---|---|
   | `site` | the site's `https://` address (plain `http` only for localhost or a `.test` dev site) |
   | `token` | the host token from step 1 |
   | `portRange` | UDP ports WebRTC may use. Forwarding them on the router is optional (it helps when there is no CGNAT) |
   | `relayOnly` | `true` sends all traffic through TURN, so players never see the PC's IP. Costs a little latency |
   | `logDir` | where `pc-host.log` goes, rotated at 5 MB |

5. **Try it in a window first:** `pc-host.cmd`. When Windows Firewall asks, allow
   `node.exe` on private and public networks (it only needs UDP). The admin page
   should now show the PC as online.
6. **Run it as a service:** download `WinSW-x64.exe` (v2.12) from the WinSW GitHub
   releases, put it in this folder next to `pc-host-service.xml` and rename it
   `pc-host-service.exe` (gitignored). Then, from an administrator prompt:

   ```bat
   cd "C:\Users\Teddy\projects\Block survival\pc-host"
   pc-host-service.exe install
   pc-host-service.exe start
   ```

   The service starts with Windows, no login needed. A crash restarts it. After
   `npm run build`, `pc-host-service.exe restart` picks up the new bundle.

## Everyday use

- **Updates, reboots, shutting down:** Windows stops the service, the app saves the
  world, and players wait on the pause screen until the PC is back.
- **Going away for a while:** run `pc-host.cmd offline` first. It saves the world,
  hands it to the browsers, and stops the service.
- **The PC died while you were away:** press *Release to browsers* on the admin
  dashboard (it works from a phone). Otherwise the world stays paused until the PC is
  back.
- **Logs:** `logs\pc-host.log` records starts, stops, freezes, and connection
  problems. The admin page shows the PC's last heartbeat, version, player count,
  connection types (`host` = direct, `srflx` = hole-punched, `relay` = TURN) and ICE
  failures.

## Develop

```bash
npm test          # Vitest: sim, room, config, real WebRTC between node-datachannel peers
npm run typecheck
npm run build     # dist/pc-host.mjs (esbuild; node-datachannel stays external)
```

The game code is not copied. `@game/*` resolves to `server/resources/js/*` (see
`aliases.mjs`), so `server/` must have its `node_modules` installed. The web client's
model loader is swapped for a headless stub (`src/headless/assets.ts`).

To try it against a local site, point `PC_HOST_CONFIG` at a config with
`"site": "http://localhost:8000"` or a Herd site such as `"http://block-survival.test"`.
Plain `http` is only accepted for localhost, 127.0.0.1 and `.test` hostnames.
