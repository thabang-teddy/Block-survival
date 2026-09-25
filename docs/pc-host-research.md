# Hosting the global world on my own PC, with the PHP site as the front door

Written 2026-09-25 and revised the same day with your decisions. **Implemented the same
day** on branch `feat/pc-host` (on top of this doc's branch). See *Implementation status*
below. The research text is unchanged except where that section says so.

## Implementation status (2026-09-25)

| Step (§5.6) | Where | State |
|---|---|---|
| 1. Invites follow the host | `Room::HOSTING_SECONDS`, `Room::adoptInvitesOfHost`, `rooms.last_seen_at` | Done, PHPUnit |
| 2. Site side of the PC | `GameHost`, `/api/host/*` (`HostController`, `AuthenticateGameHost`), `GlobalWorld` (three states, standby, take-back), mailbox identities, admin panel | Done, PHPUnit |
| 3. `pc-host/` sim + transport | `pc-host/src` (HostSim, GameRoom, HostTransport on node-datachannel) | Done, Vitest (with real DataChannels) |
| 4. Save, scores, access | `pc-host/src/site.ts`, `/api/host/world·scores·access` | Done |
| 5. Pause and reconnect | `GameRoom.freeze/resume` + held places; web `ClientSession` `paused`, `awaitHostPc`; Flutter same | Done, Vitest + Flutter tests |
| 6. `/api/ice-servers` + Cloudflare TURN | `App\Support\IceServers`; both clients and the PC fetch it | Done (HTTP faked in tests) |
| 7. Packaging, power, logs | `pc-host/scripts/package.mjs`, `windows/pc-host-service.xml` (WinSW), `src/power.ts`, `src/log.ts` | Done, see *not verified* |

**Verified live on the dev machine** (site on PHP 8.4 in Docker, PC host on Node, the
web client in a browser):

- a browser joined the PC through the real mailbox, over a direct `host` candidate;
- pausing the site for 30 s froze the PC's world after 15 s; the browser paused after
  3 s of silence and resumed over the same link when the site was back;
- killing the PC left the world **paused** (not handed to browsers); starting it again
  reloaded the last save under a new room code;
- `pc-host offline` saved, handed the world to the browsers and exited cleanly.

**Not verified yet:** the WinSW service itself (install, Ctrl+C on stop, restart on
crash); a real Cloudflare TURN key; players on other networks (CGNAT, mobile data, UDP
blocked); the HUD's rejoin after a dropped link in a visible browser tab (unit-tested
only, because the browser pane here renders no frames); the Flutter client against the
PC; the keep-awake helper; a sleep/wake cycle.

**Where the build differs from the plan above:**

- The PC reads and writes the mailbox through its own `GET /api/host/signals` and
  `POST /api/host/signal`, not `POST /api/rooms/{code}/signal` with host auth. The PC
  never touches the players' routes.
- A PC that comes back after a clean shutdown or a release **stands by**. It takes the
  world back when the browser host's room closes (it leaves, or its seat goes stale),
  or at the next heartbeat that finds nobody in the world. It never interrupts a
  browser game (§5.1).
- The lobby now lists **accepted** invites as well as pending ones, so an invitee who
  left can go back in while the host is hosting (decision 4). Before, an accepted
  invite disappeared from the lobby.
- A `bye` from the PC (restart or handover) is a pause for PC-hosted sessions, and the
  client asks the site what comes next.
- The game rules reach the PC in the heartbeat reply. A change in the admin applies
  when the PC next opens its room (after a restart or a standby), as a browser host
  reads them once per match.
- Chosen: autosave every 60 s while players are in (`Autosave`'s default). A player's
  place is kept for the whole pause, plus a 60 s return window once the PC is back.
- Left open (§6): no notification when the PC has been paused a long time, and no
  minimum PC version. The heartbeat stores the version and the admin shows it.

**The question.** A program on a Windows PC at home hosts the game. The Laravel site on
cPanel stays the front door: the host registers with it, players sign in there as now
(account, device approval, login window), the site tells them how to reach the host,
and their browsers play on the PC.

**Decisions taken (2026-09-25).**

1. **The PC hosts only the global world.** Players' own worlds stay hosted in the
   owner's browser, peer-to-peer, as today.
2. **Browser hosting stays as the fallback.** When the PC is off, the global world
   goes back to today's browser queue.
3. **PC downtime pauses the game.** When the PC drops out, the global world pauses,
   and players reconnect by themselves when it is back.
4. **Invites last as long as the host is hosting.** If user 1 invites user 2, user 2
   can join user 1 for as long as user 1 is hosting.

**Answer.** It can work. Build it on the **WebRTC path the site already uses**. The PC
joins the existing signalling mailbox as the global world's host, running the
authoritative `HostSim` in Node with `node-datachannel`, with Cloudflare's TURN
service as a fallback for connections that cannot go direct. That needs no domain, DNS
change, certificate or open TCP port. The browsers and the Flutter app keep their
transport code. The fallback in decision 2 already exists because it is how the global
world works today.

> **How decisions 2 and 3 fit together** (the grace period is set to infinite,
> 2026-09-25). An outage the PC did not announce **pauses the world until the PC is
> back**, however long that takes; browsers never take over from a paused PC. The
> browser fallback applies only when the PC is deliberately *offline*: it shut down
> cleanly, you pressed "release to browsers" in the admin, or it has never been
> registered. See §5.4.

---

## 1. What exists today, and what it means for this

| Piece | Where | Relevance |
|---|---|---|
| Signalling mailbox | `server/app/Http/Controllers/Api/SignalController.php`, `resources/js/net/transport.ts` (`Signaller`, `HostTransport`, `ClientTransport`) | Peers POST offers, answers and ICE candidates, and poll for the ones addressed to them. Only admitted players get through (`Room::admits`). The route has its own `throttle:signal` limit of 600/min per IP. A join takes about 3–4 s (`docs/cpanel-go-live.md` §3.1). |
| Global world queue | `server/app/Services/GlobalWorld.php`, `Models/GlobalSeat.php` | Players take seats. The first fresh seat hosts in its browser (`host()`), and the others join it. A seat goes stale after 45 s without a heartbeat. The host's room refresh (`PATCH /api/rooms/{code}`, every 15 s) keeps its seat fresh and vouches for the seats of the players connected to it (`touch`). **The PC slots in as a permanent front of this queue** (§5.1). |
| Browser host | `resources/js/net/HostSession.ts` | Registers the room (`POST /api/rooms`), refreshes it every 15 s, answers offers, and sends snapshots at 20 Hz over one reliable, ordered DataChannel. A new `HostSession` draws a **new room code every time** (`makeRoomCode()`). |
| Invites | `Api/InviteController.php`, `Models/RoomInvite.php`, `Room::admits` | An invite belongs to one **room row**. The invitee's lobby lists pending invites to rooms that are live and not full. After accepting, the invitee may resolve the room and use its mailbox for as long as that row is live. "Live" means `expires_at` is in the future, and each refresh pushes it **2 hours** ahead (`Room::TTL_HOURS`). |
| Server-side sim (removed) | Git history: `origin/node-server` (`66ba3d8`), or the parent of `00f0df3` on `dev`. Files `node-server/inertia/sim/HostSim.ts`, `sim/validate.ts`, `app/game/game_room.ts` | An authoritative simulation of one room with no DOM or three.js. `GameRoom` ticks it at 30 Hz, fans out snapshots at 20 Hz, rate-limits clients, re-checks access every 30 s and autosaves. It reaches the rest of its app only through the `RoomStore` interface (`saveWorld`, `recordRun`, `refreshRow`, `removeRow`, `accessProblem`), so it can run against the PHP site over HTTP. **Every game module it imports still exists in `server/resources/js`** (world, items, physics, entities, `Avatar`, `DayNight`, `rules`, `saveState`, `visitors`, `autosave`, `saveMigrate`, `seed`); only `saveTypes` has moved into `net/api.ts`. The PC host would restore these three files and import the rest from `server/`, so the game code keeps a single copy. |
| Protocols | v1 in `server/…/protocol.ts`; v2 in history | They are almost identical. v2 dropped the self-declared `userId` from `hello`, added the client message `{t:'save'}`, and added an optional `look` to `welcome`. **The PC can speak v1**, so today's web and Flutter clients join it unchanged. |
| Flutter client | `client/lib/net/` (`flutter_webrtc`, `signaller.dart`) | Joins peer-to-peer through the same mailbox and sends a v1 `hello`. |
| Database | SQLite on cPanel (`cpanel-go-live.md` §4.4) | Every mailbox request is a SQLite read or write. This rules out relaying game traffic through PHP (§3.4). |

**Traffic, measured.** I ran `HostSim` for two simulated days (1,980 s) with 4
players, msgpack-encoding what it produced (throwaway Vitest file, since deleted):

| Message | Size | Rate | Per player |
|---|---|---|---|
| snapshot (host → each client) | avg **740 B**, peak **1,661 B** (10 zombies) | 20 Hz | 15 KB/s avg, 33 KB/s peak |
| input (client → host) | **96 B** | 30 Hz | 2.9 KB/s |
| welcome (untouched world) | 255 B | once | — |

With about 80–90 B of UDP/DTLS/SCTP headers per packet and 4 players
(`MAX_PLAYERS`), the PC uploads about **0.5 Mbit/s on average and 1.1 Mbit/s at
peak**. Four hours a day comes to about **25 GB a month**. Hosting only the global
world means this is the whole load: one sim, at most 4 players.

---

## 2. Comparison

| | 1. WebRTC host on the PC (recommended) | 2. Tunnel (Cloudflare) | 2b. Tunnel (Tailscale Funnel / ngrok) | 3. Port forward + DDNS + Let's Encrypt | 4. Relay through PHP | 5. Relay VPS |
|---|---|---|---|---|---|---|
| **Works behind CGNAT** | Usually with STUN alone; always with TURN | Yes (outbound only) | Yes | **No** (no public IPv4) | Yes | Yes |
| **Needs a domain or DNS change** | No | Yes. The zone must be on Cloudflare: move the nameservers, or register a second domain | No (`*.ts.net` / ngrok dev domain) | Yes (DDNS name) | No | Optional |
| **Your setup** | Install the host app, allow it through Windows Firewall, add a Cloudflare TURN key to `.env` | Cloudflare account, DNS move, `cloudflared` service | Account, one CLI command | Router forward, DDNS client, certificate renewal | — | Rent and maintain a server |
| **Running cost** | $0. TURN has 1,000 GB/month free | $0 (+ ~$10/yr if a second domain) | Funnel $0 (bandwidth-capped). ngrok free = 1 GB/mo, which is **~2–4 h** of play | $0 | $0, but it cannot work | About US$4–6/mo |
| **Added latency** | None when direct. Through TURN, one extra hop via the nearest Cloudflare PoP | Detour through two Cloudflare edges, over TCP | Through the provider's relays, over TCP | None | ≥ 200–400 ms | One extra hop |
| **Pause and reconnect (decision 3)** | Clients re-run the join through the mailbox. The same code path as the first join | Clients reopen the `wss://` URL with a fresh ticket | Same as 2 | Same as 2 | — | Same as 2 |
| **Browser fallback (decision 2)** | Already there: the same transport | Needs both transports kept | Same as 2 | Same as 2 | — | Same as 2 |
| **Exposure of the PC** | No listening TCP port. Players see the PC's IP in ICE candidates, as peers do today. Relay-only mode hides it | No inbound port. IP hidden | IP hidden | Open TCP port, IP public | — | IP hidden |
| **How PHP vouches for players** | It adds the signed-in user and device to each offer it relays (§5.3) | Ed25519-signed ticket | Same as 2 | Same as 2 | — | Same as 2 |
| **Client changes** | Pause and reconnect UI, ICE servers from the API | A v2 WebSocket client, a URL from the API, reconnection; Flutter as well | Same as 2 | Same as 2 | — | Same as 2 |

---

## 3. The approaches in detail

### 3.1 WebRTC host on the PC through the existing mailbox (recommended)

**How it works.**

1. *Registration.* The host app authenticates with a **host token** (a random secret;
   the site stores only its hash) and sends a heartbeat every 15 s
   (`POST /api/host/heartbeat`). The heartbeat carries its version, peer id, and the
   global room's player count and connected user ids. PHP derives the PC's state from
   the time of the last heartbeat: **online**, **paused** or **offline** (§5.4).
2. *Discovery.* A player enters the global world (`POST /api/global/join`). If the PC
   is online, PHP gives them a seat and answers "the host is the PC, room `CODE`, peer
   `PC-PEER-ID`", which is the same shape of answer the queue gives today when another
   browser hosts. The browser resolves the room and posts its offer to the mailbox,
   unchanged.
3. *Hand-off.* The PC reads the global room's mailbox. PHP includes the
   **authenticated user id and device id** of whoever posted each offer, so the PC
   never trusts `hello.userId`. The PC answers the offer, and the DataChannel opens.
4. *Play.* This is today's peer-to-peer path, with the PC as the peer: DTLS-encrypted
   SCTP, one ordered reliable DataChannel, msgpack. WebRTC is not subject to
   mixed-content blocking and needs no certificate, which the existing peer-to-peer
   mode on the https site already shows.
5. *Address changes.* ICE gathers fresh candidates for every join, so a new dynamic IP
   only affects connections that are already open. Those drop, and the pause and
   reconnect flow (§5.4) brings everyone back.

**NAT traversal.**

- *STUN only* is enough for most sessions. The rule of thumb is about 80–85%; the real
  figure depends on the players' networks (GetStream; webrtc.ventures, below).
  Failures come mostly from symmetric NATs on both ends and from networks that block
  UDP (schools, offices, some mobile carriers).
- *CGNAT on the PC side* is usually fine. RFC 6888 tells carrier-grade NATs to meet
  the UDP behaviour requirements (REQ-1) and recommends endpoint-independent filtering
  (REQ-7), which is what hole punching needs. Not every ISP complies.
- *Making the PC reliably reachable.* `node-datachannel` takes a fixed UDP port range
  (`portRangeBegin`/`portRangeEnd`). Forwarding that range on the router is optional
  and helps when there is no CGNAT. If the ISP provides IPv6, ICE uses it
  automatically.
- *TURN* covers the remainder. **Cloudflare Realtime TURN** offers 1,000 GB/month
  free, then $0.05/GB. It supports UDP on 3478 and 443, TCP on 3478 and 80, and TLS on
  5349 and 443. Credentials are short-lived and minted server-side through
  `…/credentials/generate-ice-servers`, which is one short HTTPS request from PHP.
  **Metered** has 500 MB/month free, then plans from $99/month, so it is not worth it
  here. Self-hosting coturn needs a VPS (option 5).

**Setup effort.** Low: install the host app, accept the Windows Firewall prompt for
`node.exe` (UDP), and put a Cloudflare TURN key id and token in the cPanel `.env`.

**Cost.** $0.

**Latency.** A direct connection adds nothing: the path is player ↔ PC. A relayed
connection adds a detour through a Cloudflare PoP. Because the DataChannel is
reliable and ordered, a lost packet delays the ones after it, as in today's
peer-to-peer play.

**When the PC is off or asleep.** See §5.4: paused until the PC returns, unless it
shut down cleanly or was released, in which case the browser queue takes over. Own worlds and invites are unaffected, because they never
touch the PC.

**Security.**

- The PC opens no listening TCP port. The only inbound traffic is UDP that must
  complete a DTLS handshake, and the fingerprint for that handshake came through the
  authenticated mailbox.
- Players see the PC's public IP, as they see a browser host's today. Relay-only ICE
  (`iceTransportPolicy: 'relay'`) hides it, at a small cost in latency and still
  within the free tier.
- The host token only reaches the narrow `/api/host/*` endpoints for the global world.
  Revoke or rotate it from the admin page.

### 3.2 Tunnel the PC to a public https address

**How it works.** `cloudflared` (or `tailscale funnel`, or `ngrok`) on the PC makes
an outbound connection to the provider, which publishes an https hostname and forwards
`wss://` to the host app. The heartbeat reports the URL. PHP returns `{ url, ticket }`,
and the browser opens `wss://…?ticket=…`.

**Providers.**

- **Cloudflare Tunnel, named.** Free, outbound only, runs as a Windows service, and
  WebSockets are proxied on every plan. Two drawbacks:
  - The public hostname must be in a zone on Cloudflare. A **partial (CNAME) setup is
    Business/Enterprise only**, so on the Free plan the nameservers move to Cloudflare,
    including the cPanel site's A, MX and TXT records, or a second domain is
    registered.
  - Cloudflare restarts edge servers from time to time, which closes WebSockets.
- **Cloudflare Quick Tunnel (`trycloudflare.com`).** No account or domain. The URL is
  random on each start, which the heartbeat would cover. There is a 200 in-flight
  request cap and **no SLA; Cloudflare describes it as for testing**.
- **Tailscale Funnel.** Available on all plans. The hostname is stable
  (`machine.tailnet.ts.net`) and the ports are limited to 443, 8443 and 10000. Traffic
  goes through relays with **non-configurable bandwidth limits**.
- **ngrok.** The free plan has **1 GB/month**, 20k requests and an **interstitial
  page**. Hobbyist is $10/month for 5 GB. Too small.
- **frp** needs a server you run yourself, which makes it option 5.

**Why it is second choice.** The WebSocket client and protocol v2 were deleted with
node-server, so the web client would need them back. Flutter has never had them.
Browser hosting (decision 2) keeps WebRTC anyway, so both transports would have to be
maintained. It is a sensible escape hatch if too many joins fail even with TURN.

### 3.3 Port forward, dynamic DNS and a real certificate

The host app listens for `wss://` on a forwarded port, a DDNS client keeps a hostname
pointed at the home IP, and Let's Encrypt issues the certificate.

- HTTP-01 validation needs inbound port 80. DNS-01 needs a DNS provider with an API.
- **Behind CGNAT this cannot work at all**, because there is no public IPv4 to forward
  from. It also puts the home IP and a TCP listener in front of internet scanners.

It adds nothing over approach 2 except the missing hop, at a real security cost.
**Not recommended.**

### 3.4 Relay live traffic through PHP (long polling or SSE)

**Not viable.**

**Plain requests.** With 4 players and no batching:

- clients: 4 × (30 input POSTs + 20 snapshot fetches) = 200 req/s
- the PC: roughly 60 more req/s
- total: **about 260 requests a second, or ~15,600 a minute**

That is 26 times the `throttle:signal` limit of 600/min per IP. Each request is a full
Laravel boot plus a SQLite write or read. At an estimated 30–80 ms of CPU per request
(not measured), that is **8–20 CPU cores continuously**, on plans that typically give
one core and about 20 entry processes. The real limits for this account are still
*open* in `cpanel-go-live.md` §2. SQLite already reported `database is locked` with two
browsers doing signalling.

**Batched to 5 Hz with long polling.** About 50 req/s, which is still 2–4 cores, and it
adds **200–400 ms one way** before the game even runs.

**Server-sent events.** Each player holds one PHP process for the whole session,
polling SQLite about 20 times a second. Output buffering and compression on
LiteSpeed/Apache break SSE, and execution-time limits cut the stream.

### 3.5 Other options

- **Relay VPS** (typically about US$4–6/month; prices not checked). Once there is a VPS,
  it is simpler to host the global world on it and leave the PC out. The removed
  node-server was built for exactly that.
- **Players join a VPN** (Tailscale or ZeroTier without Funnel). Every player would
  have to install a client.
- **Gaming tunnels** (e.g. playit.gg) forward raw TCP/UDP. A browser needs `wss://` on a
  hostname with a valid certificate, so they do not fit.

---

## 4. Recommendation

**Build approach 1: the PC hosts the global world as a WebRTC peer through the
existing mailbox, with Cloudflare TURN as a fallback.**

1. **It fits the decisions without new transports.** From every client's point of
   view, the PC is the global world's queue host, one that never leaves. Browser
   hosting of the global world (decision 2) and of own worlds (decisions 1 and 4) is
   the same code, and already works.
2. **Pause and reconnect (decision 3) is a join repeated.** When the PC comes back,
   clients re-run the join they already know how to do.
3. **No domain, DNS, certificate or open TCP port.**
4. **Best latency.** Direct UDP to the PC.
5. **$0.**
6. **The PHP site stays the authority.** PHP decides who hosts the global world, adds
   verified identities to offers, stores the save, records scores and re-checks
   access. The PC holds only a revocable token.

**Switch to approach 2 (named Cloudflare Tunnel)** if more than a few percent of joins
fail even with TURN. The host would report ICE failures and connection types so this
can be measured.

---

## 5. Plan for the recommended approach

### 5.1 PHP endpoints (`server/`)

New table `game_hosts`: `id`, `name`, `token_hash`, `peer_id`, `version`,
`last_seen_at`, `enabled`, `offline_at` (set by a clean shutdown or a release; cleared by
the next heartbeat). An admin page creates the host, shows its token once, can revoke
it, shows the PC's current state, and has a **"release to browsers"** button that sets
`offline_at` — the way out when the PC is paused and will not be back soon, since the
pause never ends by itself (§5.4). The host routes use `auth:host`
middleware (bearer token → `GameHost`), which is **separate from user auth and never
reuses `APP_KEY`**.

| Endpoint | Caller | Does |
|---|---|---|
| `POST /api/host/heartbeat` | PC, every 15 s | Stores the version and peer id and updates `last_seen_at`. Body: the global room's code, players and connected user ids. PHP refreshes the room row and the players' seats (as `GlobalWorld::touch` does for a browser host). Replies with the game rules and commands such as "reset the global world" or "shut down". A final heartbeat with `going: 'offline'` (a shutdown) sets `offline_at`; `going: 'restart'` (an update or reboot) leaves the PC paused (§5.4). |
| `GET /api/host/signals?after=` | PC, 1 s idle / 0.5 s during a join | The global room's mailbox. Each offer row carries `from_user_id` and `from_device_id`, taken from the session or token that posted it. |
| `POST /api/rooms/{code}/signal` | PC | Existing route; host auth is accepted for the global room. |
| `GET /api/host/world` | PC, when it opens the room | The global world's gzipped save (the same storage as `WorldController::show`). |
| `PUT /api/host/world` | PC | Stores the global save, with the same checks as `WorldController::store` (`World::MAX_BYTES`, gzip magic). |
| `POST /api/host/scores` | PC | Records runs (`Score` model). |
| `POST /api/host/access` | PC, every 30 s | Batch `[{user_id, device_id}] → [{reason\|null}]` using `AccessPolicy::blockedReason` plus the device-approval check. |
| `GET /api/ice-servers` | Signed-in players and the PC | Short-lived Cloudflare TURN credentials (`generate-ice-servers`, TTL ~1 h), cached briefly. Falls back to STUN only if the call fails. |

Changes to the global world queue (`GlobalWorld`):

- `host()`: while a `GameHost` is **online or paused**, the PC is the host and every
  seat is a joiner. Otherwise the current rule applies: the oldest fresh seat hosts in
  its browser.
- `join()`, `claim()` and `state()` return a new host kind (`pc`) and a `paused` flag, so the
  client can tell "joining the PC", "the PC is paused, wait" and "you host" apart.
- **The PC coming back while a browser hosts** (after a clean shutdown or a release):
  PHP does not interrupt the browser-hosted game. The PC takes the world back when that
  room closes or empties, and the browser host's last save is the one the PC loads.
  This needs one check in `GlobalWorld::roomClosed` and one in `host()`.
- Only one host holds the global world at a time. This is already true of the queue;
  the PC becomes one more candidate, ranked first.

Other changes:

- `SignalController::store` records the poster's user and device on each row (a
  migration adds `from_user_id` and `from_device_id` to `room_signals`).
- `WorldController::update` for `global` refuses uploads from browsers while the PC
  holds the world.
- Give `/api/host/*` its own rate limiter. The PC adds 60–120 requests a minute.
- Invite changes: §5.5.

### 5.2 The host app on the PC

This goes in a new folder, `pc-host/`, with its own `package.json`. It is Node 24 and
TypeScript.

- **Sim.** Restore `sim/HostSim.ts`, `sim/validate.ts` and `game_room.ts` from
  `origin/node-server`. Point their imports at `server/resources/js` for the shared
  game modules, and move `SaveData` to the import from `net/api.ts`. Only the
  host-specific code is new.
- **`PhpRoomStore implements RoomStore`**: `saveWorld` → `PUT /api/host/world`,
  `recordRun` → `POST scores`, `refreshRow` → part of the heartbeat, `removeRow` → the
  heartbeat (no room), `accessProblem` → the batched `/access`.
- **One room.** No registry is needed, just the global room. It opens at start-up (the
  save is loaded) and is kept while the app runs. The sim ticks only while at least
  one player is connected (as `GameRoom` already does) and stays frozen while the world
  is paused (§5.4).
- **Transport.** Port `HostTransport` and `Signaller` from
  `server/resources/js/net/transport.ts` almost line for line, using
  `node-datachannel`'s `RTCPeerConnection` polyfill (v0.33.4, Sept 2026, prebuilt
  `win32-x64`, Node ≥ 18.20). `werift` (pure TypeScript, v0.24.4) is the fallback if
  the native module causes trouble. Settings: a fixed `portRangeBegin/End`, and ICE
  servers from `/api/ice-servers`.
- **Adapter for v1 clients.**
  - Accept `hello` with `v: 1`, ignore its `userId`, and take the identity from the
    offer row.
  - Send v1 a `welcome` without `look`.
  - Map each DataChannel to `GameRoom`'s `Peer`.
- **Packaging.** Ship a folder containing portable `node.exe`, the compiled JS and
  `node_modules` (so the native `.node` file sits next to it), plus `config.json` for
  the site URL, token and port range. Start it with Windows using **WinSW** (a service,
  no login needed) or a Task Scheduler "At log on" task.
- **Power.** While any player is connected, keep the PC awake with
  `SetThreadExecutionState` through a tiny helper. Whenever the app stops cleanly it
  saves the world first. When Windows stops the service (an update, a reboot or a
  shutdown) it sends `going: 'restart'`, so players stay paused: the app cannot tell
  those apart, and the PC normally comes back. Only an explicit `pc-host offline`
  command (or the admin's release button) sends `going: 'offline'` and hands the world
  to the browsers.
- **Logs.** Write to a rolling file. Report ICE failures and connection types (host,
  srflx or relay) in the heartbeat.

### 5.3 How the site vouches for players

- **The mailbox is the vouching.** `SignalController` only admits seated or invited
  players, and it would now store *who* posted each offer. The offer's SDP carries that
  browser's DTLS certificate fingerprint, so the DataChannel that opens belongs to the
  player PHP authenticated. No ticket is needed.
- **Continuing checks.** The PC re-checks access every 30 s through `/api/host/access`,
  so a disabled account, a closed login window or a revoked device ends that player's
  session.
- **Why not reuse `APP_KEY`.** It is Laravel's encryption key for session and device
  cookies. A copy on a home PC means anyone who compromises the PC can forge any user's
  session on the live site. The PC holds only a revocable host token.
- **If approach 2 is ever used:** PHP signs tickets with an Ed25519 private key
  (`sodium_crypto_sign_detached`), and the PC verifies them with the public key only.

### 5.4 PC downtime: pause until it is back; fall back only when released (decisions 2 and 3)

**PC states.** PHP derives them from `last_seen_at` and `offline_at`. There is no
grace period: a pause lasts until the PC is back.

| State | When | Global world |
|---|---|---|
| **online** | last heartbeat ≤ 45 s ago | Hosted on the PC. |
| **paused** | last heartbeat > 45 s ago (or a `going: 'restart'`), and `offline_at` is not set | Frozen, **for as long as it takes**. Players already in it wait on a "paused" screen and rejoin automatically. New arrivals see "the world is paused, waiting for the host PC" and wait the same way, or go back to the lobby and play their own world. |
| **offline** | `offline_at` set (`pc-host offline`, or the admin's release button), the host disabled, or no host ever registered | Hosted by the browser queue, as today (decision 2). |

**The cost of an infinite pause.** If the PC crashes, loses power or loses its
connection while you are away, the global world stays paused, even for players who
arrive hours later, until the PC is back or you press "release to browsers" (which can
be done from a phone). Own worlds and invites keep working throughout.

**What the player sees.**

1. The DataChannel closes, or no snapshot arrives for 3 s. The client **freezes**: it
   stops sending input, stops predicting its own movement, keeps the last frame on
   screen, and shows "Host PC offline, game paused, reconnecting…".
2. The client calls the existing `POST /api/global/claim` every 5 s. It already
   exists for "my host went away: keep my place and tell me who hosts now", and it
   would add the PC's state to its answer.
   - `online` (the PC is back): it re-runs the join (offer, answer), and the
     welcome puts it back in the world.
   - `paused`: it keeps waiting.
   - `offline`: it leaves the pause screen and follows the queue's answer, joining a
     browser host or becoming the host itself, as `claim` does today.
3. `claim` refreshes the player's seat, so they keep their place while they wait.

**What the PC does.**

- **Network blip or IP change** (the process keeps running):
  - All DataChannels drop, or heartbeats fail for more than 15 s. The PC **freezes the
    sim**: no ticks, so zombies cannot kill players who cannot move. It keeps every
    player's avatar seat for as long as the pause lasts.
  - When a player reconnects, the avatar they left is theirs again, in the same place,
    same state. When the first player is back the sim unfreezes. Only players who have
    reconnected are in it.
  - Once the PC is back online, players who do not reconnect within a **return window**
    (60 s, the same as an empty room's grace in the old `RoomRegistry`) are removed as
    if they had left: saved and dropped. Without that, a player who gave up waiting
    would hold a frozen avatar forever.
- **Sleep:** the process is suspended, which freezes the world by itself. On wake,
  `GameRoom`'s tick sees one huge `dt`. `HostSim` already clamps a step to
  `MAX_DT = 1/20 s`, but the room must also **discard the elapsed time** so day and
  night do not jump ahead. After that it continues as for a blip.
- **Crash or power cut:** the process restarts (WinSW restarts it) and loads the last
  save. Players rejoin into that save and lose what happened since the last autosave.
  To keep that loss small, the PC autosaves at a steady interval while players are in,
  in addition to dawn, when a player leaves, and at shutdown.

**Code this needs.**

- `ClientSession` (web and Flutter) gets a `paused` status: freeze, poll, rejoin.
- `GameRoom` gets `freeze()` and `resume()`. It keeps disconnected players' seats
  while frozen, and drops them after the return window once it is back.
- `GlobalWorld` gets the three states. The admin gets the release button.

### 5.5 Invites into own worlds (decisions 1 and 4)

Own worlds stay browser-hosted and never involve the PC, so decision 4 holds whether
the PC is on or off. I read the current code against "user 2 can join user 1 for as
long as user 1 is hosting":

**What already works.**

- User 1 invites from the pause screen. User 2 sees the invite in the lobby, accepts
  it, and gets the room.
- After accepting, user 2 may resolve and signal that room **any number of times**
  while it is live (`Room::admits` checks for an accepted invite), so user 2 can leave
  and come back.
- Invites to full rooms are hidden.

**Two gaps.**

1. **"Hosting" really means "hosted within the last 2 hours".** A refresh pushes
   `expires_at` 2 hours ahead. If user 1's tab crashes or the PC sleeps without
   `DELETE /api/rooms/{code}`, the room stays "live" for up to 2 hours. User 2 still
   sees the invite and waits 15 s for a connection that never comes.
   - **Fix:** add a `last_seen_at` to `rooms`, set on create and every 15 s refresh.
     Treat a room as *hosting* only while `last_seen_at` is within 45 s, the same rule
     as `GlobalSeat::STALE_SECONDS`.
   - Use that for the lobby's invite list, `accept`, `show` and the mailbox gate.
   - Keep `expires_at` for sweeping old rows and signals.
2. **Invites die when user 1 re-hosts.** Each `new HostSession()` draws a new room
   code and a new `rooms` row. After a reload, a rejoin or a crash, user 1 is hosting
   again but the invite points at the old row.
   - **Fix:** make an invite belong to the host player, not the room row. When user 1
     opens a new own-world room, `RoomController::store` moves user 1's pending and
     accepted invites whose room is no longer hosting to the new room (one `UPDATE …
     WHERE from_user_id = ?`).
   - The invite ends when user 1 stops hosting cleanly (`DELETE`), or when user 1's
     room has not been seen for 45 s. This is the room's own staleness rule and has
     nothing to do with the PC's pause.

**Result.** User 2 can join user 1 whenever user 1 is hosting, across reloads, and the
invite disappears when user 1 stops. The Flutter client uses the same API, so it gets
this for free.

### 5.6 Order of work

1. **Invites** (§5.5): room `last_seen_at`, and invites follow the host. This
   stands alone and can ship first. `php artisan test` and `npm test` in `server/`.
2. **PHP host side:** `game_hosts`, host auth, heartbeat, the three PC states in
   `GlobalWorld`, verified identities on offers. Add tests.
3. **`pc-host/`:** restore the sim files, `node-datachannel` transport, mailbox. Prove
   a v1 browser joins locally (Herd plus the host app on the same machine).
4. **`PhpRoomStore`:** save, score and access endpoints. Play a full night.
5. **Pause and reconnect:** client `paused` status, `GameRoom` freeze and resume, seat
   holding. Test by pulling the PC's network cable, sleeping it, and killing the
   process, including a pause of several hours. Then check `pc-host offline` and the
   release button handing over to the browser queue, and the PC taking the world back.
6. **`/api/ice-servers` with Cloudflare TURN.** Test from a phone on mobile data and
   from a network that blocks UDP.
7. **Packaging** (WinSW), the power helper, logs. Then promote dev → staging with the
   PC pointed at staging.

---

## 6. Risks and open questions

1. **An unattended outage pauses the global world indefinitely** (decided: the grace
   period is infinite). It ends only when the PC is back or you release it from the
   admin. Decide whether you want a notification when the PC has been paused for a
   while, e.g. an email from the next request that sees it paused for more than an
   hour. No cron is needed.
2. **Restarts pause, quitting hands over.** A service stop by Windows (update, reboot,
   shutdown) keeps players paused. Only `pc-host offline` or the release button hands
   over to the browsers. So shutting the PC down for the night keeps the world paused
   until morning, unless you run `pc-host offline` first.
3. **The PC taking the world back** only when the browser-hosted room empties (§5.1).
   The alternative is to interrupt the browser game, which would need a save handoff
   mid-game.
4. **Rollback after a crash.** Players lose what happened since the last autosave.
   Pick the autosave interval (e.g. 60 s while players are in).
5. **Your home IP is visible to players** in ICE candidates. Accept it (as with
   peer-to-peer today) or turn on relay-only mode.
6. **Upload bandwidth.** Peak is about 1.1 Mbit/s for 4 players.
7. **Your ISP's terms.** Some residential plans forbid running servers.
8. **Your cPanel host's limits** (`cpanel-go-live.md` §2, still *open*). The PC adds
   60–120 PHP requests a minute, and paused clients poll every 5 s.
9. **Cloudflare TURN key** in the cPanel `.env`. Without it, players get STUN only.
10. **Protocol.** The PC speaks v1. Pausing needs no new message, because a client
    detects silence by itself.
11. **Cheating stays as today.** Movement is client-authoritative, bounded by
    `MAX_MOVE_SPEED`.
12. **Updates to the PC app** are manual at first. The heartbeat reports `version`, so
    PHP can refuse outdated hosts.

---

## Sources

All pages were read on 2026-09-25. Dates in brackets are the pages' own
"last updated" dates.

- Cloudflare Realtime TURN: overview, ports and $0.05/GB [2026-09-25]:
  https://developers.cloudflare.com/realtime/turn/
- Cloudflare Realtime TURN FAQ: 1,000 GB free tier and credential lifetime ≤ 48 h
  [2026-07-14]: https://developers.cloudflare.com/realtime/turn/faq/
- Cloudflare TURN credential generation (`generate-ice-servers`):
  https://developers.cloudflare.com/realtime/turn/generate-credentials/
- Cloudflare Tunnel overview, outbound-only [2026-08-04]:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- Publishing through a tunnel with a CNAME to the tunnel [2026-06-23]:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/
- Partial (CNAME) zone setup is Business/Enterprise only [2026-08-14]:
  https://developers.cloudflare.com/dns/zone-setups/partial-setup/
- Quick Tunnels: 200 in-flight cap, no SSE, no SLA [2026-04-20]:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- `cloudflared` as a Windows service [2026-04-17]:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/
- Cloudflare WebSockets on all plans; edge restarts close sockets [2026-08-14]:
  https://developers.cloudflare.com/network/websockets/
- Tailscale Funnel: all plans, ports 443/8443/10000, relays, bandwidth limits
  [validated 2026-01-20]: https://tailscale.com/kb/1223/funnel
- `tailscale funnel` CLI [validated 2026-01-26]: https://tailscale.com/kb/1311/tailscale-funnel
- ngrok pricing: free 1 GB/mo, interstitial; Hobbyist $10/mo 5 GB (read 2026-09-25):
  https://ngrok.com/pricing
- Metered TURN pricing: 500 MB free, from $99/mo (read 2026-09-25):
  https://www.metered.ca/stun-turn
- node-datachannel: libdatachannel bindings, Windows prebuilds, Node ≥ 18.20;
  npm v0.33.4, published 2026-09-12: https://github.com/murat-dogan/node-datachannel
- werift: npm v0.24.4, published 2026-08-10: https://github.com/shinyoshiaki/werift-webrtc
- Let's Encrypt challenge types, HTTP-01 on port 80 and DNS-01 [2026-02-12]:
  https://letsencrypt.org/docs/challenge-types/
- RFC 6888, Common Requirements for Carrier-Grade NATs (2013):
  https://www.rfc-editor.org/rfc/rfc6888
- STUN vs TURN share of sessions, rule-of-thumb figures only:
  https://getstream.io/resources/projects/webrtc/advanced/stun-turn/ and
  https://webrtc.ventures/2024/11/selecting-and-deploying-managed-stun-turn-servers/
