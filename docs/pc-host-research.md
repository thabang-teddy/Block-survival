# Hosting the game on my own PC, with the PHP site as the front door

Research only. Written 2026-09-25 on branch `docs/pc-host-research` (cut from `dev`
at `4940cef`). No code has changed.

**The question.** A program on a Windows PC at home runs the game worlds (the "host").
The Laravel site on cPanel stays the front door: the host registers with it, players
sign in there as now (account, device approval, login window), the site tells them how
to reach the host, and their browsers play on the PC.

**Short answer.** It can work. Build it on the **WebRTC path the site already uses**:
the PC joins the existing signalling mailbox as a peer-to-peer host would, running
`node-server`'s `HostSim` and `GameRoom` in Node with `node-datachannel`. Add
Cloudflare's TURN service as a fallback for the connections where direct traffic fails.
This needs no domain, DNS change, certificate or open TCP port. The browsers and the
Flutter app keep their transport code, and the current browser hosting is still there
when the PC is off. A Cloudflare Tunnel with `wss://` is the second choice, if too many
players cannot connect directly.

---

## 1. What exists today, and what it means for this

| Piece | Where | Relevance |
|---|---|---|
| Signalling mailbox | `server/app/Http/Controllers/Api/SignalController.php`, `resources/js/net/transport.ts` (`Signaller`, `HostTransport`, `ClientTransport`) | Peers POST offers, answers and ICE candidates and poll for them. Only the host and admitted invitees get through (`Room::admits`). The route has its own `throttle:signal` limit of 600/min per IP. A join takes about 3–4 s (`docs/cpanel-go-live.md` §3.1). |
| Browser host | `resources/js/net/HostSession.ts` | Registers the room (`POST /api/rooms`), refreshes it every 15 s, answers offers, and sends snapshots at 20 Hz over one reliable, ordered DataChannel. |
| Server-side sim | `node-server/inertia/sim/HostSim.ts`, `app/game/game_room.ts`, `registry.ts` | `HostSim` has no DOM or three.js. `GameRoom` ticks it at 30 Hz, fans out snapshots at 20 Hz, rate-limits clients, re-checks access every 30 s and autosaves. **`GameRoom` reaches the rest of the app only through the `RoomStore` interface** (`saveWorld`, `recordRun`, `refreshRow`, `removeRow`, `accessProblem`), so it can be given a store that calls the PHP site over HTTP instead of Lucid. `RoomRegistry` is tied to Lucid and would be rewritten. |
| Tickets | `node-server/app/game/tickets.ts` | These are in-memory one-time tickets, so they only work when the API and the socket share one process. On the PC they would be replaced (§5.3). |
| Protocols | `server/…/protocol.ts` v1, `node-server/…/protocol.ts` v2 | **v1 and v2 are almost the same.** v2 drops the self-declared `userId` from `hello`, adds the client message `{t:'save'}`, and adds an optional `look` to `welcome`. The message shapes are otherwise identical, so a PC host can serve today's v1 joiners (web and Flutter) through a small adapter. |
| Flutter client | `client/lib/net/` (`flutter_webrtc`, `signaller.dart`) | Joins peer-to-peer through the same mailbox and sends a v1 `hello` with `userId`. It cannot use the v2 WebSocket protocol yet (node-server README). |
| Database | SQLite on cPanel (`cpanel-go-live.md` §4.4) | Every mailbox request is a SQLite write or read. This rules out relaying through PHP (§3.4). |

**Traffic, measured.** I ran the real `HostSim` for two simulated days (1,980 s)
with 4 players and msgpack-encoded what it produced, using a throwaway Vitest file that
has since been deleted:

| Message | Size | Rate | Per player |
|---|---|---|---|
| snapshot (host → each client) | avg **740 B**, peak **1,661 B** (10 zombies) | 20 Hz | 15 KB/s avg, 33 KB/s peak |
| input (client → host) | **96 B** | 30 Hz | 2.9 KB/s |
| welcome (untouched world) | 255 B | once | — |

Add about 80–90 B of UDP/DTLS/SCTP headers per packet. With 4 players (`MAX_PLAYERS`)
the PC uploads about **0.5 Mbit/s on average and 1.1 Mbit/s at peak**, and downloads
about 0.2 Mbit/s. Any home connection handles this. Four players for four hours a day
comes to about **25 GB a month**, which matters for the metered services below.
Block-edit and private-state messages come on top of this but are occasional.

---

## 2. Comparison

| | 1. WebRTC host on the PC (recommended) | 2. Tunnel (Cloudflare) | 2b. Tunnel (Tailscale Funnel / ngrok) | 3. Port forward + DDNS + Let's Encrypt | 4. Relay through PHP | 5. Relay VPS |
|---|---|---|---|---|---|---|
| **Works behind CGNAT** | Usually with STUN alone; always with TURN | Yes (outbound only) | Yes | **No** (no public IPv4) | Yes | Yes |
| **Needs a domain or DNS change** | No | Yes. The zone must be on Cloudflare: move the domain's nameservers, or register a second domain there | No (`*.ts.net` / ngrok dev domain) | Yes (DDNS name) | No | Optional |
| **Your setup** | Install the host app, allow it through Windows Firewall, add a Cloudflare TURN key to `.env` | Cloudflare account, DNS move, `cloudflared` as a Windows service | Tailscale or ngrok account, one CLI command | Router port forward, DDNS client, certificate renewal | — | Rent and maintain a server |
| **Running cost** | $0. TURN has 1,000 GB/month free and relayed play is tens of GB | $0 (+ ~$10/yr if a second domain) | Funnel $0 (bandwidth-capped). ngrok free = 1 GB/mo, which is **~2–4 h** of 4-player play | $0 | $0, but it cannot work | About US$4–6/mo |
| **Added latency** | None when direct. Through TURN, one extra hop via the nearest Cloudflare PoP | Detour through two Cloudflare edges, over TCP | Through Tailscale/ngrok relays, over TCP | None | ≥ 200–400 ms | One extra hop |
| **When the PC is off** | Players fall back to browser hosting as today | Game unavailable unless fallback kept (needs both transports) | Same as 2 | Same as 2 | — | Same as 2 (or host on the VPS and drop the PC) |
| **Exposure of the PC** | No listening TCP port. Players see the PC's IP in ICE candidates, as they already see each other's today. Relay-only mode can hide it | No inbound port. IP hidden | IP hidden | Open TCP port, IP public, internet scanners | — | IP hidden |
| **How PHP vouches for players** | It adds the signed-in user and device to each offer it relays (§5.3) | Ed25519-signed ticket in the `wss://` URL | Same as 2 | Same as 2 | — | Same as 2 |
| **Browser changes** | Get ICE servers from the API; lobby routes to the PC room | A v2 WebSocket client pointed at a URL the API supplies, plus reconnection | Same as 2 | Same as 2 | — | Same as 2 |
| **Flutter changes** | None required (TURN optional) | Needs the WebSocket protocol, which it lacks | Same | Same | — | Same |

---

## 3. The approaches in detail

### 3.1 WebRTC host on the PC through the existing mailbox (recommended)

**How it works.**

1. *Registration.* The host app authenticates to the site with a **host token** (a
   random secret; the site stores only its hash). It sends a heartbeat every 15 s
   (`POST /api/host/heartbeat`) with its version, the rooms it runs, their player
   counts and the user ids present. PHP marks the host **online** until 45 s after the
   last heartbeat.
2. *Discovery.* A signed-in player presses Play. If the host is online, PHP creates or
   returns the room row with `host_peer_id` set to the PC's peer id and replies as it
   does for any room. Otherwise PHP answers as it does today and the browser hosts. The
   player's browser resolves the room and posts its offer to the mailbox, unchanged.
3. *Hand-off.* The PC reads **one host-wide mailbox**
   (`GET /api/host/signals?after=`) covering every room it owns. PHP includes the
   **authenticated user id and device id** of whoever posted each offer, so the PC
   never trusts `hello.userId`. If the offer names a room the PC does not have running,
   the PC fetches the room's details and save (`GET /api/host/rooms/{code}`), starts a
   `HostSim` and answers the offer.
4. *Play.* This is today's peer-to-peer path with the PC as the peer: DTLS-encrypted
   SCTP, one ordered reliable DataChannel, msgpack. WebRTC is not subject to
   mixed-content blocking and needs no certificate, which the existing peer-to-peer
   mode on the https site already shows.
5. *Address changes.* No address is ever published, because ICE gathers fresh
   candidates for every join, so a new dynamic IP only affects connections already
   open. Those drop, and the player re-joins from the lobby in 3–4 s. ICE restart could
   be added later but is not needed at first.

**NAT traversal.**

- *STUN only* is enough for most connections. The industry rule of thumb is that
  about 80–85% of sessions connect without a relay, but the real share depends on the
  players' networks (GetStream; webrtc.ventures, below). Failures come mostly from
  symmetric NATs on both ends and from networks that block UDP (schools, offices, some
  mobile carriers).
- *CGNAT on the PC side* is usually fine. RFC 6888 tells carrier-grade NATs to meet
  the UDP behaviour requirements (REQ-1) and recommends endpoint-independent filtering
  (REQ-7), which is what hole punching needs. Not every ISP complies.
- *Making the PC reliably reachable.* `node-datachannel` takes a fixed UDP port range
  (`portRangeBegin`/`portRangeEnd`). If the router allows it, forwarding that range
  makes the PC's candidates reachable from nearly any client. This is optional and
  helps only if there is no CGNAT. If the ISP provides IPv6, ICE uses it automatically,
  often with no NAT at all.
- *TURN* covers the remainder. **Cloudflare Realtime TURN** offers 1,000 GB/month
  free, then $0.05/GB. It supports UDP on 3478 and 443, TCP on 3478 and 80, and TLS on
  5349 and 443, so it gets through firewalls that only allow HTTPS. Credentials are
  short-lived and minted by a server-side call to `…/credentials/generate-ice-servers`,
  which is one short HTTPS request from PHP and fits shared hosting. At about 25 GB a
  month even with everyone relayed, it stays free. **Metered** has 500 MB/month free
  and paid plans from $99/month, so it is not worth it here. Self-hosting coturn needs a
  VPS (option 5).

**Setup effort.** Low: install and start the host app, accept the Windows Firewall
prompt for `node.exe` (UDP), and put a Cloudflare TURN key id and token in the cPanel
`.env`.

**Cost.** $0.

**Latency.** A direct connection adds nothing: the path is player ↔ PC. A relayed
connection adds a detour through a Cloudflare PoP. Because the DataChannel is
reliable and ordered, a lost packet delays the ones after it (head-of-line blocking),
exactly as in today's peer-to-peer play.

**When the PC is off or asleep.** Heartbeats stop and after 45 s PHP stops sending
players to it. New games fall back to browser hosting, which already exists. Players
in a game when the PC went down see `host-left` and re-join, landing on a browser host.
The world is only as fresh as the PC's last save. Autosave, dawn and leave saves keep
the loss small, but it is not zero.

**Security.**

- The PC opens no listening TCP port. The only inbound traffic is UDP to ICE
  candidates, and it must complete a DTLS handshake whose fingerprint came through the
  authenticated mailbox.
- The players see the PC's public IP, as players already see each other's today. To
  hide it, the host can use relay-only ICE (`iceTransportPolicy: 'relay'`). All traffic
  then goes through TURN, at a small cost in latency and still within the free tier.
- The host token lets the PC save worlds, record scores and read access state through
  narrow `/api/host/*` endpoints and nothing else. Revoke or rotate it from the admin
  page.

**Code changes.** See §5.

### 3.2 Tunnel the PC to a public https address

**How it works.** `cloudflared` (or `tailscale funnel`, or `ngrok`) on the PC makes
an outbound connection to the provider, which publishes `https://host.example.com`
and forwards `wss://` to the host app on `localhost:4000`. The host reports its public
URL in its heartbeat. On Play, PHP returns `{ url, ticket }`, and the browser opens
`wss://…/ws?ticket=…` and speaks protocol v2. This is node-server's model with the
socket on another origin.

**Providers.**

- **Cloudflare Tunnel, named.** Free, outbound only, and runs as a Windows service.
  WebSockets are proxied on every plan. Two drawbacks:
  - The public hostname must be in a zone on Cloudflare. A **partial (CNAME) setup is
    Business/Enterprise only**, so on the Free plan the domain's nameservers move to
    Cloudflare, including the cPanel site's A, MX and TXT records, or a second domain
    is registered for the game.
  - Cloudflare may restart edge servers, which closes WebSockets. Clients therefore
    need a reconnect path, and node-server's client has none today.
- **Cloudflare Quick Tunnel (`trycloudflare.com`).** No account or domain. The URL is
  random and changes on each start, which is harmless since the heartbeat reports it.
  There is a 200 in-flight request cap and **no SLA; Cloudflare describes it as for
  testing**. Good enough for a trial, not for launch.
- **Tailscale Funnel.** Available on all plans. The hostname is stable
  (`machine.tailnet.ts.net`) and the ports are limited to 443, 8443 and 10000. Traffic
  goes through Tailscale's Funnel relays, which have **non-configurable bandwidth
  limits**. TLS terminates on the PC, and the TCP proxy carries WebSockets.
- **ngrok.** The free plan has **1 GB/month** (≈2–4 h of 4-player play), 20k requests
  and an **interstitial warning page**. Hobbyist is $10/month for 5 GB. Too small.
- **frp** needs a server you run yourself, which makes it option 5.

**Latency.** The path is player → nearest edge → provider backbone → the edge
`cloudflared` connects to → PC, over TCP. On a nearby PoP the extra time is usually
small, but it is never below the direct WebRTC path. TCP retransmission stalls behave
like the ordered DataChannel.

**Security.** The PC's IP is hidden and no inbound port is opened. The weak point is
the ticket (§5.3). Anything that reaches the tunnel URL reaches the host app, so the
`/ws` upgrade must reject every request that lacks a valid ticket, as
`socket_server.ts` already does.

**Code changes.** More than approach 1:

- PHP must mint signed tickets and report the tunnel URL.
- The server/ web client needs node-server's v2 WebSocket `ClientSession`, taking its
  URL from the API instead of `location.host`, plus reconnection.
- The Flutter app needs a WebSocket client and protocol v2.
- The browser-hosting fallback would still need the WebRTC client, so both transports
  have to be kept.

### 3.3 Port forward, dynamic DNS and a real certificate

The host app listens for `wss://` on a forwarded port, a DDNS client keeps a hostname
pointed at the home IP, and Let's Encrypt issues the certificate.

- HTTP-01 validation needs inbound port 80. DNS-01 needs a DNS provider with an API.
  Either way the host app has to renew the certificate itself.
- **Behind CGNAT this cannot work at all**, because there is no public IPv4 to forward
  from. It also exposes the home IP and a TCP listener to the whole internet, and
  scanners will find it within hours.
- Latency is the best of the TCP options.
- Setup depends on the router and ISP.

It adds nothing over approach 2 except the missing hop, at a real security cost.
**Not recommended.**

### 3.4 Relay live traffic through PHP (long polling or SSE)

**Not viable.**

**Plain requests.** With 4 players and no batching:

- clients: 4 × (30 input POSTs + 20 snapshot fetches) = 200 req/s
- the PC: fetches the inputs and posts the snapshots, roughly 60 more req/s
- total: **about 260 requests a second, or ~15,600 a minute**

That is 26 times the `throttle:signal` limit of 600/min per IP. Each request is a full
Laravel boot and a SQLite write or read. I estimate 30–80 ms of CPU per request on
shared hosting (not measured), so this needs **8–20 CPU cores continuously**. CloudLinux
shared plans typically give one core and about 20 concurrent "entry processes"; the
real limits for this account are still *open* in `cpanel-go-live.md` §2. SQLite
serialises writers, and the go-live doc already hit `database is locked` with just two
browsers doing signalling.

**Batched to 5 Hz with long polling.**

- About 50 req/s (≈3,000/min), still 2–4 cores.
- Each exchange adds a 200 ms batching delay plus two round trips to cPanel plus PHP
  time: **200–400 ms one way** before the game even runs. Movement would feel
  rubber-banded, and combat hit checks on the host would be judged against stale
  positions.

**Server-sent events.**

- Each player holds one PHP process for their whole session: 5 of the ~20 entry
  processes for one 4-player game. Each process must poll SQLite about 20 times a
  second, because PHP has no pub/sub.
- Output buffering and compression on LiteSpeed/Apache often break SSE, and
  `max_execution_time` or proxy timeouts cut the stream.
- Inputs still need POSTs.
- A single game could slow the site for everyone, and most shared hosts' terms forbid
  this kind of use.

The mailbox is only workable because it is used for a few seconds per join.

### 3.5 Other options

- **Relay VPS** (Hetzner, DigitalOcean or Vultr, typically about US$4–6/month; prices
  not checked). The VPS could run coturn for TURN or frp for a tunnel. But
  **`node-server` was built for a VPS**: once there is a VPS, the simplest design is to
  host the game on it and leave the PC out. Consider this if uptime matters more than
  $0.
- **Players join a VPN** (Tailscale or ZeroTier without Funnel). Every player would
  have to install a client, which a browser game cannot ask of them.
- **Gaming tunnels** such as playit.gg forward raw TCP/UDP to a shared address. A
  browser needs `wss://` with a valid certificate on a hostname, so these do not fit.

---

## 4. Recommendation

**Build approach 1: the PC as a WebRTC host through the existing mailbox, with
Cloudflare TURN as a fallback.**

1. **The browsers and Flutter already do this.** They join peer-to-peer rooms through
   the mailbox. From a client's point of view the PC is just another host that never
   leaves. Only the lobby's routing changes, plus an optional ICE-server fetch.
2. **No domain, DNS, certificate or open TCP port.** Your cPanel DNS and email stay
   as they are. Approach 2 would move nameservers or buy a domain.
3. **It degrades gracefully.** When the PC is off, the current browser hosting takes
   over with no extra code. Every tunnel option would need both transports anyway to
   keep that fallback.
4. **Best latency.** Direct UDP to the PC, with no TCP detour through two edges.
5. **$0.** Even if every connection were relayed, usage stays at about 2–3% of
   Cloudflare's free TURN allowance.
6. **The PHP site stays the authority.** PHP creates rooms, gates the mailbox, adds
   verified identities to offers, stores saves and scores, and re-checks access. The PC
   holds no key that can sign anyone in.

**Switch to approach 2 (named Cloudflare Tunnel)** if, after launch, more than a few
percent of joins fail even with TURN. Measure this by logging ICE failures to the host
and the site. A quick tunnel is a zero-setup way to try approach 2 before committing
to the DNS move.

---

## 5. Plan for the recommended approach

### 5.1 PHP endpoints (`server/`)

New table `game_hosts`: `id`, `name`, `token_hash`, `peer_id`, `version`,
`last_seen_at`, `enabled`, and an optional `worlds` scope (`global`, `own` or both).
An admin page creates the host and shows its token once, and can revoke it. The host
routes use `auth:host` middleware (bearer token → `GameHost`), which is **separate from
user auth and never reuses `APP_KEY`**.

| Endpoint | Caller | Does |
|---|---|---|
| `POST /api/host/heartbeat` | PC, every 15 s | Stores the version and peer id and marks the host online (TTL 45 s). Body lists running rooms with player counts and user ids, and PHP refreshes those `rooms` rows as `HostSession.tick` does. Replies with the game rules and pending commands such as "close room X" (admin kick, global reset) and "shut down". |
| `GET /api/host/signals?after=` | PC, 1 s idle / 0.5 s during a join | The mailbox for **every** room the host owns. Each offer row carries `from_user_id` and `from_device_id`, taken from the session or token that posted it. |
| `POST /api/rooms/{code}/signal` | PC | Existing route. Host auth is accepted for rooms the host owns. |
| `GET /api/host/rooms/{code}` | PC | Room kind, owner, host name and the gzipped save (reusing `WorldController::show`'s storage). |
| `PUT /api/host/worlds/{kind}/{owner?}` | PC | Stores a gzipped save for that owner or the global world, with the same checks as `WorldController::store` (`World::MAX_BYTES`, gzip magic). |
| `POST /api/host/scores` | PC | Records runs (`Score` model), replacing node-server's `recordRun`. |
| `POST /api/host/access` | PC, every 30 s per room | Batch `[{user_id, device_id}] → [{reason|null}]` using `AccessPolicy::blockedReason` plus the device-approval check. Replaces `accessProblem`. |
| `DELETE /api/host/rooms/{code}` | PC | Room closed. |
| `GET /api/ice-servers` | Signed-in players and the PC | Short-lived Cloudflare TURN credentials (`generate-ice-servers`, TTL ~1 h), cached briefly. Falls back to STUN only if the call fails. |

Changes to existing behaviour:

- `POST /api/rooms` and `global/join` send a player to the PC's room when a host is
  online; otherwise they behave as today. For the **global world**, PHP must make sure
  only one host holds it at a time. It already does this with the queue: the PC takes
  the front of the queue while it is online.
- `SignalController::store` records the poster's user and device on each row (a
  migration adds `from_user_id` and `from_device_id` to `room_signals`).
- `WorldController::update` refuses owner uploads while the PC runs that world, as
  node-server does.
- The throttle: the PC polls at 60–120 requests a minute from its own IP, well under
  600/min. Give `/api/host/*` its own limiter.

### 5.2 The host app on the PC

This can be a new folder (`pc-host/`) or an entry point inside `node-server/` that
reuses its code.

- **Sim.** Import `HostSim`, `validate` and `GameRoom` unchanged.
- **`PhpRoomStore implements RoomStore`**, the only real seam: `saveWorld` → `PUT`,
  `recordRun` → `POST scores`, `refreshRow` → part of the heartbeat, `accessProblem` →
  the batched `/access`.
- **`PcRegistry`**, a slim `RoomRegistry` without Lucid. It opens a room when an offer
  for an unknown code arrives, and closes rooms that stay empty for 60 s.
- **Transport.** Port `HostTransport` and `Signaller` from `server/resources/js/net/transport.ts`
  almost line for line, using `node-datachannel`'s `RTCPeerConnection` polyfill
  (v0.33.4, Sept 2026, prebuilt `win32-x64`, Node ≥ 18.20). `werift` (pure
  TypeScript, v0.24.4) is the fallback if the native module causes trouble. Settings:
  a fixed `portRangeBegin/End`, and ICE servers from `/api/ice-servers`.
- **Adapter for v1 clients.**
  - Accept `hello` with `v: 1`, ignore its `userId`, and take the identity from the
    offer row.
  - Send v1 a `welcome` without `look`, which it ignores anyway.
  - The v1 `save` button is host-only, so owners rely on autosave until the client
    gains a "save" message.
  - Map each DataChannel to `GameRoom`'s `Peer` (`send` and `close`).
- **Packaging.** Ship a folder containing portable `node.exe`, the compiled JS and
  `node_modules` (so the native `.node` file sits next to it), plus `config.json` for
  the site URL, token and port range. Start it with Windows using **WinSW** (a service
  that runs without a login) or a Task Scheduler "At log on" task (simplest).
  `pm2` on Windows is unreliable.
- **Power.** While any player is connected, keep the PC awake:
  `SetThreadExecutionState` through a tiny helper, or the power plan set to never
  sleep. On shutdown (service stop or Ctrl-C), save every room as
  `RoomRegistry.shutdown` does, then send a final heartbeat with `going_offline`.
- **Logs.** Write to a rolling file, and report ICE failures and connection types
  (host, srflx or relay) in the heartbeat, so the §4 switch point can be measured.

### 5.3 How the site vouches for players

- **Approach 1 (recommended).** The mailbox is the vouching.
  - `SignalController` only admits invited or authenticated players, and it would now
    store *who* posted each offer.
  - The offer's SDP carries that browser's DTLS certificate fingerprint. Only the
    holder of that certificate can complete the handshake, so the DataChannel that
    opens belongs to the player PHP authenticated. No ticket is needed.
  - The host keeps re-checking access every 30 s through `/api/host/access`.
- **Approach 2, if chosen.** PHP signs `{uid, device, room, exp: now+30s, nonce}` with
  an **Ed25519 private key** using `sodium_crypto_sign_detached` (libsodium ships with
  PHP). The PC verifies with the **public key** only and remembers nonces until they
  expire, so each ticket works once.
- **Why not reuse `APP_KEY`.** It is Laravel's encryption key for session and device
  cookies. A copy on a home PC means anyone who compromises the PC can forge any user's
  session on the live site. An HMAC with any shared secret has the same flaw in smaller
  form, since the PC could mint tickets. Keep the PC holding only what it needs: a
  revocable host token and, for approach 2, a public key.

### 5.4 Browser changes (`server/resources/js`)

- `transport.ts`: build `RTC_CONFIG` from `GET /api/ice-servers` (STUN-only fallback).
- The lobby: "Play my world" and "Global world" go to the PC's room when the API says
  so, and the owner joins as a client (`ClientSession`) instead of hosting.
- Show "hosted on the server PC" versus "hosted in your browser", so players understand
  what happens when the PC is off.
- Later, optionally: send `save` from owners, and auto-rejoin on `host-left` when the
  API still reports the room.

Flutter (`client/`) works without changes. Fetching ICE servers there too (for TURN)
is the only follow-up.

### 5.5 Order of work

1. PHP: `game_hosts`, host auth, heartbeat and the host mailbox with verified offer
   identities. Add tests (`php artisan test`).
2. PC app: `node-datachannel` transport and mailbox. Prove a v1 browser joins an empty
   `HostSim` world locally (Herd plus the host app on the same machine).
3. `PhpRoomStore` and the save, score and access endpoints. Play a full night.
4. Lobby routing, global-world arbitration, and fallback when the heartbeat stops.
5. `/api/ice-servers` with Cloudflare TURN. Test from a phone on mobile data and from
   a network that blocks UDP.
6. Packaging (WinSW), the power helper and logging. Then promote dev → staging with the
   PC pointed at staging.

---

## 6. Risks and open questions for you

1. **Which worlds does the PC host?** Only the global world, or every player's own
   world as well? Each open world is a `HostSim` ticking at 30 Hz with a chunk ring
   per player. A handful are fine on a desktop; dozens are not. Also decide whether to
   cap the number of rooms.
2. **Keep browser hosting as the fallback?** I recommend yes, because it is free
   resilience. The cost is that a world can move between the PC and a browser, so the
   save handoff must be clean: the PC saves on close, and the browser loads the latest
   save.
3. **Your home IP is visible to players** in ICE candidates. Accept this (as with
   peer-to-peer today) or turn on relay-only mode. Relay-only costs a little latency
   and uses some of the free TURN allowance.
4. **Uptime of a home PC.** Windows Update restarts, sleep, power cuts and ISP drops
   end games in progress, and the world rolls back to its last save. Is that acceptable,
   or does the global world need a VPS?
5. **Upload bandwidth.** Peak is about 1.1 Mbit/s for 4 players. Check your line's
   upload, especially if other household traffic competes.
6. **Your ISP's terms.** Some residential plans forbid running servers. WebRTC
   connections are set up from the PC's side through NAT, but it is still hosting.
7. **Your cPanel host's limits** (`cpanel-go-live.md` §2, still *open*). The PC adds
   60–120 PHP requests a minute on top of browser hosts. Fill in the entry-process and
   CPU limits before launch.
8. **Cloudflare account and TURN key** in the cPanel `.env`. If Cloudflare's endpoint
   fails, players get STUN only and some cannot join. That is acceptable at first, but
   log it.
9. **Protocol.** Keep the PC speaking v1, as recommended, until the web client and
   Flutter share one protocol; otherwise bump both clients.
10. **Cheating stays as today.** Movement is client-authoritative, bounded by
    `MAX_MOVE_SPEED`. A PC host is no weaker than a browser host, and no stronger.
11. **Who restarts the PC app after an update?** Ship updates by hand at first. The
    heartbeat reports `version`, so PHP can refuse outdated hosts after a protocol
    change.

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
