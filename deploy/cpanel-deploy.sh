#!/usr/bin/env bash
#
# deploy/cpanel-deploy.sh — deploy one environment ON the cPanel account.
#
#   ssh <user>@<host>
#   bash ~/staging/app/deploy/cpanel-deploy.sh ~/staging/app
#   PHP_BIN=/opt/alt/php84/usr/bin/php bash ~/production/app/deploy/cpanel-deploy.sh ~/production/app
#
# <app-dir> must be a clone of an artefact branch (deploy/staging or
# deploy/production) — CI builds those; see docs/cpanel-go-live.md §5–§6.
#
# What it does, in order (§6.1):
#   lock → find PHP ≥ 8.4 → check .env → maintenance on → fetch + reset --hard
#   → storage dirs → migrate ONLY if pending (SQLite backup first) → rebuild
#   caches → maintenance off → log.
#
# It never writes .env, never runs `git clean`, never deletes storage/.

set -Eeuo pipefail

MIN_PHP_ID=80400                      # PHP 8.4 — keep in step with CPANEL_PHP_VERSION in .github/workflows/ci.yml
LOG_FILE="${DEPLOY_LOG:-$HOME/logs/deploy.log}"
KEEP_PRE_MIGRATE_BACKUPS=10
PHP_CANDIDATES=(
  php
  /opt/alt/php84/usr/bin/php
  /opt/cpanel/ea-php84/root/usr/bin/php
  /usr/local/bin/php
)

# ---------------------------------------------------------------------------
# arguments
# ---------------------------------------------------------------------------
if [ $# -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: $0 <app-dir>     (a clone of deploy/staging or deploy/production)" >&2
  exit 64
fi
APP_DIR="$(cd "$1" && pwd -P)"

# ---------------------------------------------------------------------------
# logging: everything to stdout AND the deploy log
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$LOG_FILE")"
# cPanel's jailed shell has no /dev/fd, so `exec > >(tee ...)` fails with
# "/dev/fd/62: No such file". Re-run ourselves through a plain pipe instead;
# only the inner run does any work (and takes the lock).
if [ -z "${CPANEL_DEPLOY_TEE:-}" ]; then
  export CPANEL_DEPLOY_TEE=1
  set +e
  bash "$0" "$@" 2>&1 | tee -a "$LOG_FILE"
  exit "${PIPESTATUS[0]}"
fi

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die()  { log "ERROR: $*"; exit 1; }

PHASE=prepare   # prepare | down | tree-changed | up
on_error() {
  local rc=$1 line=$2
  log "FAILED (exit $rc) at line $line during phase '$PHASE'"
  case "$PHASE" in
    down)
      # nothing changed on disk yet — safe to bring the old release back
      log "tree untouched; bringing the site back up"
      "$PHP" "$APP_DIR/artisan" up >/dev/null 2>&1 || true
      ;;
    tree-changed)
      log "site LEFT IN MAINTENANCE MODE: the tree was updated but a later step failed."
      log "fix the cause, re-run this script, or run: $PHP $APP_DIR/artisan up"
      ;;
  esac
  exit "$rc"
}
trap 'on_error $? $LINENO' ERR

log "===== deploy start: $APP_DIR ====="

# ---------------------------------------------------------------------------
# 1. one deploy at a time per app dir
# ---------------------------------------------------------------------------
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || die "another deploy is already running for $APP_DIR"

# ---------------------------------------------------------------------------
# 2. a PHP CLI that is at least 8.4
# ---------------------------------------------------------------------------
php_version_id() { "$1" -r 'echo PHP_VERSION_ID;' 2>/dev/null || echo 0; }

find_php() {
  local candidate
  if [ -n "${PHP_BIN:-}" ]; then
    [ "$(php_version_id "$PHP_BIN")" -ge "$MIN_PHP_ID" ] && { echo "$PHP_BIN"; return 0; }
    return 1
  fi
  for candidate in "${PHP_CANDIDATES[@]}"; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    [ "$(php_version_id "$candidate")" -ge "$MIN_PHP_ID" ] && { command -v "$candidate"; return 0; }
  done
  return 1
}

PHP="$(find_php)" || die "no PHP >= 8.4 CLI found (tried PHP_BIN and: ${PHP_CANDIDATES[*]}). Set PHP_BIN=/path/to/php84"
log "php: $PHP ($("$PHP" -r 'echo PHP_VERSION;'))"
artisan() { "$PHP" "$APP_DIR/artisan" --no-interaction "$@"; }

# ---------------------------------------------------------------------------
# 3. .env sanity — the script never creates or edits it (§4.7)
# ---------------------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || die ".env missing at $ENV_FILE — copy deploy/.env.cpanel.example there and fill it in"

env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

[ -n "$(env_get APP_KEY)" ] || die "APP_KEY is empty — run: $PHP $APP_DIR/artisan key:generate"
[ "$(env_get APP_DEBUG)" != "true" ] || log "WARNING: APP_DEBUG=true on a server leaks .env on any error page"

DB_CONNECTION="$(env_get DB_CONNECTION)"
DB_DATABASE="$(env_get DB_DATABASE)"
if [ "$DB_CONNECTION" = "sqlite" ]; then
  [ -n "$DB_DATABASE" ] || die "DB_CONNECTION=sqlite but DB_DATABASE is empty — use an absolute path outside the repo (§4.4)"
  case "$DB_DATABASE" in
    /*) ;;
    *)  die "DB_DATABASE must be an absolute path (got '$DB_DATABASE') — a relative one resolves against the CWD, not the app" ;;
  esac
  case "$DB_DATABASE" in
    "$APP_DIR"/*) log "WARNING: the SQLite file lives inside the git tree; §4.4 keeps it outside" ;;
  esac
fi

# ---------------------------------------------------------------------------
# tree must be an artefact branch
# ---------------------------------------------------------------------------
git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP_DIR is not a git clone (§4.5)"
BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
case "$BRANCH" in
  deploy/*) ;;
  *) die "expected a clone of deploy/staging or deploy/production, but the tree is on '$BRANCH'" ;;
esac
BEFORE="$(git -C "$APP_DIR" rev-parse --short HEAD)"

if [ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
  log "WARNING: tracked files were edited on the server; reset --hard will discard them:"
  git -C "$APP_DIR" status --short --untracked-files=no | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 4. maintenance mode
# ---------------------------------------------------------------------------
PHASE=down
artisan down --retry=15 --refresh=15 >/dev/null
log "maintenance mode on"

# ---------------------------------------------------------------------------
# 5. bring the tree to the tip of the artefact branch
#    (orphan force-pushes → fetch + reset, never pull; §5.1)
# ---------------------------------------------------------------------------
git -C "$APP_DIR" fetch --quiet --force --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
PHASE=tree-changed
git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
AFTER="$(git -C "$APP_DIR" rev-parse --short HEAD)"
if [ -f "$APP_DIR/BUILD_INFO" ]; then
  log "artefact $AFTER: $(tr '\n' ' ' < "$APP_DIR/BUILD_INFO")"
else
  log "artefact $AFTER (no BUILD_INFO — not built by CI?)"
fi

# ---------------------------------------------------------------------------
# 6. writable runtime directories (untracked, survive every deploy)
# ---------------------------------------------------------------------------
mkdir -p \
  "$APP_DIR/storage/app/public" \
  "$APP_DIR/storage/framework/cache/data" \
  "$APP_DIR/storage/framework/sessions" \
  "$APP_DIR/storage/framework/views" \
  "$APP_DIR/storage/logs" \
  "$APP_DIR/bootstrap/cache"
chmod -R u+rwX "$APP_DIR/storage" "$APP_DIR/bootstrap/cache"

# ---------------------------------------------------------------------------
# 7. migrations — only when something is pending
# ---------------------------------------------------------------------------
if [ "$DB_CONNECTION" = "sqlite" ] && [ ! -f "$DB_DATABASE" ]; then
  mkdir -p "$(dirname "$DB_DATABASE")"
  : > "$DB_DATABASE"
  log "created empty SQLite database at $DB_DATABASE"
fi

backup_sqlite_before_migrate() {
  [ "$DB_CONNECTION" = "sqlite" ] || return 0
  [ -s "$DB_DATABASE" ] || return 0            # nothing to lose yet
  local dir stamp target
  dir="$(dirname "$DB_DATABASE")/backups"
  stamp="$(date '+%Y%m%d-%H%M%S')"
  target="$dir/pre-migrate-$stamp.sqlite"
  mkdir -p "$dir"
  # fold the WAL into the main file so a plain copy is complete (the app is down)
  "$PHP" -r '(new PDO("sqlite:".$argv[1]))->exec("PRAGMA wal_checkpoint(TRUNCATE);");' "$DB_DATABASE"
  cp -p "$DB_DATABASE" "$target"
  log "pre-migration backup: $target"
  # keep the newest N
  ls -1t "$dir"/pre-migrate-*.sqlite 2>/dev/null | tail -n +"$((KEEP_PRE_MIGRATE_BACKUPS + 1))" | xargs -r rm -f
}

# `migrate:status --pending=1` exits 1 when migrations are pending; it also exits
# non-zero on a fresh database with no migrations table. Both mean "migrate".
# It runs as an `if` condition: `set +e` alone is not enough, because the ERR
# trap fires regardless of errexit and would abort the deploy here.
if PENDING_OUT="$(trap - ERR; artisan migrate:status --pending=1 --no-ansi 2>&1)"; then
  log "no pending migrations"
else
  log "pending migrations:"
  printf '%s\n' "$PENDING_OUT" | grep -vE '^\s*$' | sed 's/^/    /'
  backup_sqlite_before_migrate
  artisan migrate --force --no-ansi
  log "migrations applied"
fi

# ---------------------------------------------------------------------------
# 8. caches (config:cache is safe: no env() outside config/ — §3.3)
# ---------------------------------------------------------------------------
artisan optimize:clear --no-ansi >/dev/null
artisan config:cache   --no-ansi >/dev/null
artisan route:cache    --no-ansi >/dev/null
artisan view:cache     --no-ansi >/dev/null
artisan event:cache    --no-ansi >/dev/null
log "caches rebuilt"

# ---------------------------------------------------------------------------
# 9. back up
# ---------------------------------------------------------------------------
artisan up >/dev/null
PHASE=up
git -C "$APP_DIR" gc --auto --quiet || true
log "===== deployed $BRANCH $BEFORE -> $AFTER ($APP_DIR) ====="
