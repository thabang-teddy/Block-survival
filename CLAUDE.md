# Block Survival — project rules

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

`php artisan test` and `npm test` must pass before a PR is opened.
`phpunit.xml` pins `APP_MAINTENANCE_MODE=false`; do not read maintenance state
from `.env` in tests.
