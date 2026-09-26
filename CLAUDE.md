# Block Survival — project rules

## Layout

One project per folder: `server/` (Laravel + web client — run every `php`,
`composer` and `npm` command from there), `client/` (native Flutter client),
`pc-host/` (the Node app that hosts the global world on a home PC; it imports
the game code from `server/resources/js`, so `server/` needs `npm ci` first),
`shared/` (contracts both clients load). The CI artefact is `server/` itself.

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
and `npm test` in `pc-host/` when it or the shared game code changed.
`phpunit.xml` pins `APP_MAINTENANCE_MODE=false`; do not read maintenance state
from `.env` in tests.
