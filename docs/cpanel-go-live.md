# Block Survival — cPanel go-live

Source of truth for how this application is deployed to shared cPanel hosting.
Every decision below states what it costs. Measurements are recorded as
measured, not as conclusions. Unknowns are listed in §10, never invented.

Written 2026-09-13 against commit `027b9a2`. Host: **not yet measured** (§2.0).

---

## §0 — What the code assumes vs what cPanel gives

| The design assumes | cPanel shared hosting gives | Consequence |
|---|---|---|
| ~~Laravel Reverb WebSocket server for WebRTC signalling~~ (removed, §3.1) | No process supervisor, no custom listening ports; PHP only runs per-request under LiteSpeed/Apache | Signalling is a polled mailbox in the database. **§3.1** |
| `DB_CONNECTION=sqlite` at `database/database.sqlite` (dev default) | Any file the account can write. cPanel backups cover `$HOME`, not "the database" | SQLite file kept **outside the git tree** at `$HOME/<env>/data/block-survival.sqlite`. **§4.4** |
| `SESSION_DRIVER`, `CACHE_STORE`, `QUEUE_CONNECTION` = `database` | Works unchanged on SQLite | Nothing dispatches jobs (`grep ShouldQueue server/app/` is empty; `RoomSignal` is `ShouldBroadcastNow`) → **no queue worker**. |
| `php ^8.3` in composer.json, PHP 8.4.20 locally | PHP Selector per account; user has chosen **8.4** | CI builds vendor on 8.4; deploy script refuses anything older (`MIN_PHP_ID=80400`). |
| Docroot is `public/` | Primary domain docroot is `public_html/` and often cannot be changed; addon/sub-domains can point anywhere | **§4.3**: each environment is a (sub)domain whose docroot is `.../public`. |
| Vite build on the dev machine (`npm run build`) | No Node on most shared plans | CI builds the bundle and commits `public/build/` to the artefact branch. **§5** |
| `composer install` on the server | Composer may exist but memory/time limits bite | CI runs `composer install --no-dev` and commits `vendor/` to the artefact branch. **§5** |
| Mail: `MAIL_MAILER=log` | The app sends no mail (no `Mail::` in `app/`) | Stays `log`. Revisit if password reset is ever added. |
| No scheduler entries (`routes/console.php` has only `inspire`) | cPanel cron available | No `schedule:run` cron needed. Expired rooms are filtered by `expires_at`, never pruned (§10). |
| No file uploads (`Storage::` unused) | — | `storage/` holds only logs and compiled views. Still never deleted by a deploy. |
| Single hostname | — | No second host needed. Reverb's `REVERB_HOST` becomes irrelevant after §3.1. |

## §0.1 — Cost constraint

**Nothing beyond the hosting plan.** No Pusher/Ably, no container host for
Reverb, no error-reporting SaaS. That is why §3.1 is polling through the
database rather than a hosted broadcaster, and why error reporting is
`storage/logs/laravel.log` plus `LOG_LEVEL=warning`.

---

## §2 — Phase 0 checklist (re-run on any new host)

1. SSH in. Run the probe in §2.0 verbatim. Paste the output into §2.0.
2. In the cPanel UI record: subdomain limit, cron availability, whether
   *Terminal* / *SSH Access* / *Git Version Control* / *MultiPHP Manager* (or
   CloudLinux *Select PHP Version*) exist.
3. Confirm `git` and a PHP ≥ 8.4 CLI binary exist and which path it is.
4. Confirm the required extensions load under that binary (list in the probe).
5. Confirm outbound `github.com:443` is open (needed for `git fetch` over HTTPS).

## §2.0 — The measured host

> **NOT YET MEASURED.** Run this on the account and paste the output here.
> Nothing in §3–§9 that depends on a host fact may be executed before this
> section is filled in.

```bash
echo "user: $(whoami)"; echo "home: $HOME"
for p in /usr/local/bin/php /opt/alt/php8*/usr/bin/php /opt/cpanel/ea-php8*/root/usr/bin/php; do
  [ -x "$p" ] && echo "  $p -> $($p -r 'echo PHP_VERSION;' 2>/dev/null)"
done
echo "default php: $(php -v | head -1)"
echo "extensions missing:"; php -r 'foreach(["pdo_sqlite","sqlite3","mbstring","openssl","curl","fileinfo","tokenizer","xml","ctype","json","bcmath","intl"] as $e) if(!extension_loaded($e)) echo "  $e\n";'
echo "memory_limit: $(php -r 'echo ini_get("memory_limit");')  max_execution_time: $(php -r 'echo ini_get("max_execution_time");')"
echo "symlink: $(php -r 'echo function_exists("symlink")?"yes":"no";')  proc_open: $(php -r 'echo function_exists("proc_open")?"yes":"no";')"
for t in git composer flock tar gzip curl sqlite3; do printf '%-10s %s\n' "$t" "$(command -v $t || echo MISSING)"; done
timeout 5 bash -c 'exec 3<>/dev/tcp/github.com/443' 2>/dev/null && echo "github.com:443 OPEN" || echo "github.com:443 BLOCKED"
df -h "$HOME" | tail -1
echo "sqlite lib: $(php -r 'echo (new PDO("sqlite::memory:"))->query("select sqlite_version()")->fetchColumn();')"
```

| Fact | Value |
|---|---|
| Provider / plan | *open* |
| Account user | *open* |
| PHP CLI path for 8.4 | *open* |
| PHP version reported | *open* |
| Missing extensions | *open* |
| `memory_limit` | *open* |
| `git` path | *open* |
| SQLite library version | *open* (Laravel 13 wants ≥ 3.26; ≥ 3.35 for `DROP COLUMN`) |
| Subdomain limit | *open* |
| SSH access | **assumed yes** (user chose manual-SSH deploys; confirm on the plan) |
| Git Version Control UI | *open* — not required for the chosen pull method |

---

## §3 — Code changes required before any deploy

### §3.1 — Signalling: Reverb → HTTP polling through the database

**Done 2026-09-13** (on `dev`). What changed:

- Table `room_signals` (`id`, `room_code`, `from_peer`, `to_peer`, `type`,
  `data` JSON, `created_at`), indexed on (`room_code`, `to_peer`, `id`) — one
  migration, so **the first deploy after this runs `migrate`** (§6.1 step 7).
- `POST /api/rooms/{code}/signal` **inserts a row** (201 + `id`);
  `GET /api/rooms/{code}/signals?to={peer}&after={id}` returns that peer's
  rows past the cursor, oldest first, 50 per page. Both under `throttle:signal`,
  raised from 240 to **600/min per IP** (a host and a joiner behind one NAT
  both polling at 500 ms is ~240/min on its own).
- `server/resources/js/net/transport.ts` `Signaller` polls with an id cursor:
  **500 ms while a handshake is in flight** (any signal in the last 10 s),
  **1.5 s idle** — the host polls for the whole match to accept late joiners;
  a joining client polls at 500 ms and stops the moment its DataChannel opens.
  Errors back off 1 s → 5 s; a 404 (room gone) stops the poller and surfaces
  "The game is no longer open." `echo.ts` deleted.
- Stale rows (older than `Room::TTL_HOURS`) are swept whenever any room is
  opened; a room's rows go when it is closed — no cron.
- Removed `laravel/reverb`, `laravel-echo`, `pusher-js`, `config/reverb.php`,
  `config/broadcasting.php`, `routes/channels.php`, `app/Events/RoomSignal.php`,
  every `REVERB_*` / `VITE_REVERB_*` / `BROADCAST_CONNECTION` env line.

Three things the browser run found that unit tests could not, each already
paid for once:

- **`TrimStrings` ate the SDP's trailing CRLF** and Chrome rejected the offer
  (`Invalid SDP line` on the last line). `bootstrap/app.php` exempts
  `data.sdp`; `ApiTest` asserts the round trip byte-for-byte.
- **The signal routes must sit outside the `/api` group's `throttle:60,1`** —
  middleware stacks, and a poller at 500 ms is 120/min alone. They are in
  their own group with only `throttle:signal`.
- **`database is locked` under two browsers**, from the rate limiter's cache
  increment: a DEFERRED SQLite transaction that reads then writes gets
  `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` never waits on. §3.2 now sets
  `transaction_mode = IMMEDIATE`. `Signaller.send()` also retries a 5xx or
  network failure twice (300 ms, 600 ms), since a lost offer is a failed join.

Measured locally (Herd, two tabs, same machine): host → join → world synced in
~3 s. Cost as designed: a join is ~3–4 s instead of ~1 s (offer → host poll
≤ 0.5 s → answer → client poll ≤ 0.5 s → candidates trickle a hop or two
each). A hosting browser costs the server ~40 requests/min idle, ~120/min
during a join; each is a full Laravel boot, so on the first `database is
locked` or CPU throttle from the host the idle cadence (`POLL_IDLE_MS`) is the
knob. Gameplay traffic is still peer-to-peer and unaffected.

### §3.2 — SQLite connection tuned for concurrent writers

**Done 2026-09-13.** `config/database.php` sqlite connection:
`busy_timeout` 5000 ms, `journal_mode` wal, `synchronous` normal,
`transaction_mode` **IMMEDIATE** (all overridable via `DB_BUSY_TIMEOUT` /
`DB_JOURNAL_MODE` / `DB_SYNCHRONOUS` / `DB_TRANSACTION_MODE`). IMMEDIATE is
what makes the busy timeout apply to read-then-write transactions (§3.1).
Cost: WAL keeps `-wal`/`-shm` sidecar files next to the DB; backups must
checkpoint first (the deploy script and §8 do).

### §3.3 — Nothing else

No `env()` calls outside `config/`, so `config:cache` is safe and the deploy
script uses it. No `Storage::`, no mail, no queue, no scheduler.

---

## §4 — cPanel setup

### §4.1 — Domains

Two environments, two hostnames, each a separate clone and separate database:

| Env | Hostname | Clone path | DB file |
|---|---|---|---|
| staging | `staging.<domain>` (*open*) | `$HOME/staging/app` | `$HOME/staging/data/block-survival.sqlite` |
| production | `<domain>` (*open*) | `$HOME/production/app` | `$HOME/production/data/block-survival.sqlite` |

### §4.2 — PHP

MultiPHP Manager (or CloudLinux PHP Selector) → set both hostnames to **8.4**.
If `php` on `$PATH` is not 8.4, pass the CLI path from §2.0 as `PHP_BIN` when
running the deploy script.

### §4.3 — Docroot

Create the subdomain (staging) with docroot `$HOME/staging/app/public`. For
production, if the primary domain's docroot is locked to `public_html`, the
two working options are:

1. Point a subdomain (`play.<domain>`) at `$HOME/production/app/public` and
   redirect the apex to it. Cost: the URL gains a subdomain.
2. Replace `public_html` with a symlink to `$HOME/production/app/public`
   (`rmdir public_html && ln -s production/app/public public_html`). Cost:
   some cPanel tools refuse to work on a symlinked `public_html`, and
   `symlink` must be allowed (§2.0).

Decide after §2.0. Recorded here as *open*.

### §4.4 — Database

SQLite, file outside the repo. Chosen by the user; costs stated:

- **No cPanel "database" backup** — the file is only covered by whole-account
  backups; §8 adds a daily copy.
- **Single writer.** SQLite serialises writes; with ≤ a few dozen concurrent
  players and only rooms/scores/saves/sessions written, this is fine. If
  `database is locked` appears in the log, migrate to MySQL (cPanel → MySQL
  Databases, `DB_CONNECTION=mysql`) — the migrations are engine-neutral.
- `config/database.php` now sets `journal_mode=wal`, `busy_timeout=5000`,
  `synchronous=normal` for the sqlite connection (§3.2) — the stock config
  left all three `null`, which is DELETE-journal with no wait and would lock
  under two concurrent writers. The `data/` directory must be writable for
  the `-wal`/`-shm` files.

### §4.5 — Git on the server

```bash
mkdir -p ~/staging/data ~/production/data ~/logs
git clone --branch deploy/staging    --single-branch https://github.com/thabang-teddy/Block-survival.git ~/staging/app
git clone --branch deploy/production --single-branch https://github.com/thabang-teddy/Block-survival.git ~/production/app
```

The repo is public, so HTTPS needs no credential. If it ever goes private,
add a **read-only deploy key** per environment in cPanel → SSH Access and
switch the remote to `git@github.com:`.

### §4.6 — SSL

AutoSSL covers both hostnames once they resolve. `APP_URL` must be `https://`
and `SESSION_SECURE_COOKIE=true`.

### §4.7 — The `.env`

Copy `deploy/.env.cpanel.example` to `~/<env>/app/.env`, `chmod 600`, fill in:

| Value | Source | Blocking |
|---|---|---|
| `APP_KEY` | `php artisan key:generate` on the server (writes itself) | yes — app 500s without it |
| `APP_URL` | the hostname from §4.1 | yes — Inertia asset URLs and CSRF |
| `DB_DATABASE` | absolute path from §4.1 | yes |
| `APP_ENV` | `staging` / `production` | yes |
| `APP_DEBUG` | `false` | yes — `true` leaks `.env` on any error page |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the one account that can open `/admin` (issue #1) | yes — without an admin nobody can approve a PC, and no player can sign in |

Everything else in the example file is a fixed decision, not a secret.

The admin section (`/admin`) gates every other sign-in: there is no
self-registration or password reset — the admin creates every player account
(any password is accepted) — a new browser waits for an admin to approve it,
and the admin can limit sign-in to operating hours. `ADMIN_EMAIL` is always an
admin, even before `admin:sync` has run, so the account can never lock itself
out; `php artisan admin:sync` (step 7b of the deploy script) creates it and
resets its password to `ADMIN_PASSWORD`. To promote an existing player from the
shell: `php artisan user:make-admin <email>`.

---

## §5 — The pipeline

### §5.0 — Branches

| Branch | Who writes it | What it is |
|---|---|---|
| `dev` | you | integration branch — all work lands here first |
| `staging` | PR from `dev` only | staging source |
| `master` | PR from `staging` only | production source |
| `deploy/staging` | **CI only** | built artefact of `staging` |
| `deploy/production` | **CI only** | built artefact of `master` |

**Promotion order: `dev` → `staging` → `master`.** Nothing skips a stage.

1. Work on `dev` (directly, or on a feature branch merged into `dev`).
2. Open a PR `dev` → `staging`; merge once CI is green. Push to `staging`
   builds `deploy/staging`; validate on the staging subdomain (§7).
3. Open a PR `staging` → `master`; merge. Push to `master` builds
   `deploy/production`.

Hotfixes follow the same path — the round trip is minutes, and it keeps
`staging` a true preview of what production will get.

Enforcement, two layers:
- CI job `flow` (§5.1) fails any PR into `staging` whose head is not `dev`, and
  any PR into `master` whose head is not `staging`.
- GitHub branch protection on `staging` and `master` (set once, by hand:
  *Settings → Branches → Add rule*): **require a pull request before merging**,
  **require status checks** (`flow`, `Test (PHPUnit + Vitest)`), and leave
  "allow force pushes" off. Without this, a direct `git push` bypasses `flow`.

Pull requests run tests only; they never build an artefact.

### §5.1 — The workflow: `.github/workflows/ci.yml`

Job `flow` (PRs only): the §5.0 promotion-order check. No checkout, no deps.

The Laravel app lives in `server/` (the repo also holds `client/`, the native
Flutter app, and `shared/`); `test` and `build` run every command there, and
the artefact is `server/` itself, so the deploy branches and everything below
about the cPanel side are unchanged.

Job `test` (every push and PR):
- PHP 8.4 (`shivammathur/setup-php`), `composer install`, `php artisan test`
- Node 24, `npm ci`, `npm run typecheck`, `npm test`

Job `build` (push to `master`/`staging` only, needs `test`; a push to `dev` runs `test` and stops):
- `composer install --no-dev --optimize-autoloader --classmap-authoritative` on PHP 8.4
- `npm ci && npm run build`
- Assemble a tree from `server/`: source + `vendor/` + `public/build/`, minus
  `node_modules`, `tests`, `.env*`, `storage/logs/*`
- Commit it as a **single orphan commit** and force-push to `deploy/<env>`

Why orphan + force: the artefact branch never accumulates history (a fresh
`vendor/` per build would grow the repo by tens of MB each time). Cost: the
server must `fetch` + `reset --hard`, never `pull` (§6.1 does this), and
`.git` on the server needs an occasional `git gc` (§6.1 runs `gc --auto`).

`concurrency: deploy-<ref>` with `cancel-in-progress` so two rapid pushes
cannot race on the same artefact branch.

### §5.2 — What reaches the server, and with what credential

The server **pulls**; GitHub holds **no credential for the server**. The only
secret in the pipeline is `GITHUB_TOKEN` (automatic, scoped to this repo,
`contents: write` for the artefact push).

### §5.3 — Pull method: manual SSH

User's choice. After a green `build` run:

```bash
ssh <user>@<host>
~/staging/app/deploy/cpanel-deploy.sh ~/staging/app          # or ~/production/app
```

Cost: nothing deploys until you run it — which is also the benefit. If this
becomes tedious, a cron poller is the next step (§10).

---

## §6 — The deploy script and cron

### §6.1 — `deploy/cpanel-deploy.sh <app-dir>`

Runs on the server. In order:

1. `flock` on `<app-dir>/.deploy.lock` — refuse to run twice at once.
2. Find PHP: `$PHP_BIN` if set, else the first of `php`,
   `/opt/alt/php84/usr/bin/php`, `/opt/cpanel/ea-php84/root/usr/bin/php`
   reporting `PHP_VERSION_ID >= 80400`. Abort otherwise.
3. Refuse if `.env` is missing or `APP_KEY` is empty (never writes `.env`).
4. `php artisan down --retry=15`. An error trap decides what happens on
   failure: if the tree has not been touched yet, `artisan up` restores the
   old release; if `reset --hard` already ran, the site is **left in
   maintenance** and the log says so — a half-deployed tree must not serve.
5. `git fetch origin <branch>` then `git reset --hard origin/<branch>`.
   `storage/` and `.env` are untracked/ignored so `reset --hard` leaves them;
   **`git clean` is never used.** Tracked files edited on the server are
   listed as a warning before they are discarded.
6. Ensure `storage/{app,framework/{cache,sessions,views},logs}` exist and
   `bootstrap/cache` is writable. Delete the previous deploy's compiled files in
   `bootstrap/cache/` (the artefact ships none, so they would otherwise survive
   `reset --hard`) and run `package:discover` — a package removed since the last
   deploy would make every later artisan call fail at boot.
7. **Migrations if needed**: `php artisan migrate:status --pending`; if any
   are listed, copy the SQLite file to `<data>/backups/pre-migrate-<ts>.sqlite`
   first, then `php artisan migrate --force`. Otherwise print "no pending
   migrations" and skip.
   7b. `php artisan admin:sync` — creates/updates the `ADMIN_EMAIL` account
   (idempotent; only warns when the variable is empty).
8. `php artisan optimize:clear` then `config:cache`, `route:cache`,
   `view:cache`, `event:cache` (safe: §3.3).
9. `php artisan up`. `git gc --auto`. Append one line to `~/logs/deploy.log`.

Every step's output goes to stdout **and** `~/logs/deploy.log`.

### §6.2 — Cron

None required now. When §8 backups are set up, one line:

```
15 3 * * * /bin/bash $HOME/production/app/deploy/cpanel-backup.sh >> $HOME/logs/backup.log 2>&1
```

---

## §7 — Validating on staging

Checks the dev setup never needed:

- S.1 `https://staging.<domain>/` renders the menu (Inertia page, no console errors)
- S.2 Login + logout round-trip (an account created in `/admin/users`); cookie is `Secure`, `SameSite=Lax`
- S.3 `/api/leaderboard` returns JSON, not HTML (docroot and `.htaccess` correct)
- S.4 Post a score, save and continue a cloud save (writes to the SQLite file)
- S.5 **Host a game on one browser, join from another** — proves §3.1 on the host's PHP/LiteSpeed (passed locally 2026-09-13)
- S.6 `storage/logs/laravel.log` has no `database is locked` after S.5
- S.7 Run the deploy script a second time with no changes: "no pending migrations", `up` OK
- S.8 A deliberately empty `APP_KEY` → script refuses before touching the tree
- S.9 `php artisan migrate:status` matches the migrations in the branch
- S.10 Response headers show no `X-Powered-By` PHP version (cPanel `expose_php` off — if on, add to §10)

---

## §8 — Backups and the restore drill

`deploy/cpanel-backup.sh` (to write in Stage D): copies `data/block-survival.sqlite`
with `sqlite3 .backup` (consistent under WAL) to `data/backups/daily-<date>.sqlite`,
keeps 14. Cost: disk = 14 × DB size, trivial.

Restore drill, done once on staging before production has data: `artisan down`,
copy a backup over `block-survival.sqlite`, delete `-wal`/`-shm`, `artisan up`,
verify a known score is present. Record the date it was done here: *open*.

---

## §9 — Cutover and rollback

Cutover: DNS already points at the host (AutoSSL needs that), so cutover is
"run the deploy script on production for the first time". Point of no return
is the first real user registration.

Rollback: `git reset --hard <previous-artefact-sha>` (the script logs each
deployed SHA) + restore the pre-migrate SQLite copy the script made, then
re-run steps 8–9 of §6.1. ~2 min. Only works if no user data was written
since — otherwise roll forward.

---

## §10 — Accepted risks and open questions

| Item | Why accepted / why open | Revisit when |
|---|---|---|
| Domain, provider, plan, DNS host | **open** — not asked yet | Before §4 |
| Docroot method for the apex (§4.3) | depends on §2.0 | After the probe |
| SQLite under concurrency | user's choice; few writers; engine-neutral migrations | first `database is locked` in the log |
| Expired `rooms` rows never pruned | tiny table, filtered by `expires_at` | if the table passes ~100k rows |
| No error reporting service | cost constraint §0.1 | if silent failures are suspected |
| Manual deploys | user's choice | when it becomes a chore → cron poller |
| `public_html` symlink may be refused by cPanel | some hosts | at §4.3 |
| `expose_php` | unknown until S.10 | staging validation |

---

## §11 — Order of work

**Stage A — repo (no host needed)**
1. Commit this plan, `ci.yml`, `deploy/cpanel-deploy.sh`, `deploy/.env.cpanel.example`. ← *this session*
2. Create `staging` from `master`, push both; confirm `test` and `build` are green and `deploy/staging`, `deploy/production` exist.
3. ~~**§3.1 signalling rewrite**~~ done on `dev` 2026-09-13 → promote `dev` → `staging`.

**Stage B — measure (needs SSH)**
4. Run the §2.0 probe; fill §2.0; answer the §10 opens (domain, plan).
5. Decide §4.3 docroot.

**Stage C — staging**
6. Create subdomain, set PHP 8.4, clone `deploy/staging` (§4.5), write `.env` (§4.7).
7. First deploy by hand: `deploy/cpanel-deploy.sh ~/staging/app`.
8. Checks S.1–S.10.

**Stage D — safety**
9. Write and cron `cpanel-backup.sh`; do the restore drill; record its date in §8.

**Stage E — production**
10. Clone `deploy/production`, `.env`, deploy, S.1–S.6 again on the real hostname.
11. Cutover (§9).

Depends-on: 3 before 8 (S.5 cannot pass without it); 9 before 10.
