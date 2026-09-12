# Block Survival — API (Laravel)

Accounts, room codes, leaderboard and cloud saves for the game in `../game`. Token auth via
Sanctum bearer tokens; JSON only; every route rate-limited. The game works fully without it —
the API adds the leaderboard, cloud saves and a record of live rooms.

```bash
composer install
cp .env.example .env && php artisan key:generate   # SQLite by default
php artisan migrate
php artisan serve --port=8000                        # the game's Vite dev server proxies /api here
php artisan test
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{name, email, password}` → `{token, user}` |
| POST | `/api/auth/login` | – | `{email, password}` → `{token, user}` |
| POST | `/api/auth/logout` | token | revoke the current token |
| GET | `/api/auth/me` | token | current user |
| POST | `/api/rooms` | optional | `{code, host_peer_id, host_name}` — host registers a room (2 h TTL) |
| GET | `/api/rooms/{code}` | – | resolve a live room |
| PATCH | `/api/rooms/{code}` | – | host refreshes TTL / player count (`host_peer_id` proves ownership) |
| DELETE | `/api/rooms/{code}` | – | host closes the room |
| POST | `/api/scores` | token | `{nights, kills, deaths, seconds}` — score recomputed server-side |
| GET | `/api/leaderboard` | – | top 20 players by best score |
| GET | `/api/saves` | token | list the account's save slots |
| PUT | `/api/saves/{slot}?night=&seconds=` | token | body: gzipped JSON (≤ 2 MB) |
| GET | `/api/saves/{slot}` | token | the gzipped bytes back (`application/gzip`) |
| DELETE | `/api/saves/{slot}` | token | remove a slot |

Deploying the game separately from the API: build the game with `VITE_API_URL=https://api.example.com`
and allow that origin in `config/cors.php`.

## Not yet

Laravel Reverb as the WebRTC signalling channel (the game still uses the public PeerJS broker for the
handshake); email verification; password reset.
