# Block Survival — project rules

## Layout

One project per folder: `server/` (Laravel + web client — run every `php`,
`composer` and `npm` command from there), `client/` (native Flutter client),
`kotlin-client/` (native Kotlin **Android** client — a from-scratch port, not a
wrapper: pure-Kotlin/JVM logic modules `:world`, `:net`, `:physics` with no
Android dependency, plus an `:app` Compose + OpenGL ES module; run `gradle` from
there),
`host-app/` (the Windows app and MSI that host global worlds on a home PC; .NET 10)
with `host-app/pc-host/` inside it (the Node host it installs and drives; it imports
the game code from `server/resources/js`, so `server/` needs `npm ci` first),
`shared/` (contracts every client loads). The CI artefact is `server/` itself.

## Branch flow (enforced)

Promotion order is **`dev` → `staging` → `master`**; never skip a stage and
never push directly to `staging` or `master`.

- Commit work on `dev` (or a feature branch merged into `dev`).
- Promote with a PR `dev` → `staging`, then a PR `staging` → `master`.
- CI job `flow` rejects PRs that come from the wrong branch; GitHub branch
  protection blocks direct pushes. Details: `docs/cpanel-go-live.md` §5.0.
- `deploy/staging` and `deploy/production` are CI-owned build artefacts —
  never commit to them.

## Testing

`php artisan test` and `npm test` (both in `server/`) must pass before a PR is opened,
and `npm test` in `host-app/pc-host/` when it or the shared game code changed, and
`dotnet test` in `host-app/` when the Windows app changed, and the pure-logic
fixture suites in `kotlin-client/` — `./gradlew :world:test :net:test :physics:test`
(JVM, no device or emulator; they read `shared/fixtures/` and are the cross-play
contract, same as `client/test/`) — when the Kotlin client or the shared game
code changed.
`phpunit.xml` pins `APP_MAINTENANCE_MODE=false`; do not read maintenance state
from `.env` in tests.
