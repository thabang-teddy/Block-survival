#!/usr/bin/env bash
#
# deploy/node-deploy.sh — deploy one environment of node-server ON its host.
#
#   ssh <user>@<host>
#   bash ~/node-staging/app/deploy/node-deploy.sh ~/node-staging/app
#   bash ~/node-production/app/deploy/node-deploy.sh ~/node-production/app
#
# <app-dir> must be a clone of an artefact branch (deploy/node-staging or
# deploy/node-production). CI builds those from `staging` and `master`: each is one
# orphan commit holding the compiled server (`node ace build`), the web client's
# bundle and this script. See node-server/README.md "Deploying".
#
# What it does, in order:
#   lock → check Node ≥ 24 and .env → fetch + reset --hard → npm ci --omit=dev
#   → SQLite backup → migrate → admin:sync → (re)start under pm2 → health check → log.
#
# It never writes .env and never deletes the database. Running worlds are saved by the
# server itself when pm2 stops it (it listens for SIGINT / SIGTERM).

set -Eeuo pipefail

MIN_NODE_MAJOR=24
LOG_FILE="${DEPLOY_LOG:-$HOME/logs/node-deploy.log}"
KEEP_BACKUPS=10
HEALTH_TRIES=20

if [ $# -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: $0 <app-dir>     (a clone of deploy/node-staging or deploy/node-production)" >&2
  exit 64
fi
APP_DIR="$(cd "$1" && pwd -P)"

mkdir -p "$(dirname "$LOG_FILE")"
# everything to stdout AND the log (a plain pipe: some hosts have no /dev/fd)
if [ -z "${NODE_DEPLOY_TEE:-}" ]; then
  export NODE_DEPLOY_TEE=1
  set +e
  bash "$0" "$@" 2>&1 | tee -a "$LOG_FILE"
  exit "${PIPESTATUS[0]}"
fi

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }
trap 'log "FAILED (exit $?) at line $LINENO — the running server was left as it was unless the log says it restarted"' ERR

log "===== node deploy start: $APP_DIR ====="

# ---------------------------------------------------------------------------
# 1. one deploy at a time per app dir
# ---------------------------------------------------------------------------
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || die "another deploy is already running for $APP_DIR"

# ---------------------------------------------------------------------------
# 2. tools
# ---------------------------------------------------------------------------
command -v node >/dev/null || die "node not found — install Node $MIN_NODE_MAJOR (nvm, or the host's Node selector)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] || die "node $(node -v) is too old; node-server needs $MIN_NODE_MAJOR+"
command -v npm >/dev/null || die "npm not found"
PM2="${PM2_BIN:-$(command -v pm2 || true)}"
[ -n "$PM2" ] || die "pm2 not found — install it once with: npm install -g pm2 (it keeps the server running and restarts it on reboot)"
log "node $(node -v), pm2 $("$PM2" -v)"

# ---------------------------------------------------------------------------
# 3. .env sanity — the script never creates or edits it
# ---------------------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || die ".env missing at $ENV_FILE — copy .env.example there and fill it in (NODE_ENV=production, APP_KEY, PORT, DB_DATABASE, ADMIN_*)"
env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

[ -n "$(env_get APP_KEY)" ] || die "APP_KEY is empty — generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
[ "$(env_get NODE_ENV)" = "production" ] || log "WARNING: NODE_ENV is '$(env_get NODE_ENV)', not production (debug pages, dev guest sign-in)"
PORT="$(env_get PORT)"
[ -n "$PORT" ] || die "PORT is empty in .env"
DB_DATABASE="$(env_get DB_DATABASE)"
[ -n "$DB_DATABASE" ] || die "DB_DATABASE is empty — use an absolute path outside the app dir, e.g. $HOME/data/block-survival.sqlite3"
case "$DB_DATABASE" in
  /*) ;;
  *)  die "DB_DATABASE must be an absolute path (got '$DB_DATABASE'): the app dir is reset on every deploy" ;;
esac
case "$DB_DATABASE" in
  "$APP_DIR"/*) log "WARNING: the SQLite file lives inside the git tree; keep it outside" ;;
esac

# ---------------------------------------------------------------------------
# 4. the tree must be an artefact branch; bring it to the tip
#    (orphan force-pushes → fetch + reset, never pull)
# ---------------------------------------------------------------------------
git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP_DIR is not a git clone"
BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
case "$BRANCH" in
  deploy/node-*) ;;
  *) die "expected a clone of deploy/node-staging or deploy/node-production, but the tree is on '$BRANCH'" ;;
esac
APP_NAME="block-survival-${BRANCH#deploy/}"     # block-survival-node-staging / -node-production
BEFORE="$(git -C "$APP_DIR" rev-parse --short HEAD)"
git -C "$APP_DIR" fetch --quiet --force --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
AFTER="$(git -C "$APP_DIR" rev-parse --short HEAD)"
if [ -f "$APP_DIR/BUILD_INFO" ]; then
  log "artefact $BEFORE → $AFTER: $(tr '\n' ' ' < "$APP_DIR/BUILD_INFO")"
else
  log "artefact $BEFORE → $AFTER (no BUILD_INFO — not built by CI?)"
fi

# ---------------------------------------------------------------------------
# 5. production dependencies (better-sqlite3 fetches its native binding here)
# ---------------------------------------------------------------------------
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
log "dependencies installed"
mkdir -p "$APP_DIR/tmp" "$(dirname "$DB_DATABASE")"

# ---------------------------------------------------------------------------
# 6. database: back up, then migrate (a no-op when nothing is pending)
# ---------------------------------------------------------------------------
if [ -s "$DB_DATABASE" ]; then
  BACKUP_DIR="$(dirname "$DB_DATABASE")/backups"
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/$(basename "$DB_DATABASE").$(date '+%Y%m%d-%H%M%S').pre-deploy"
  cp "$DB_DATABASE" "$BACKUP"
  log "database backed up to $BACKUP"
  # keep the newest few
  ls -1t "$BACKUP_DIR"/"$(basename "$DB_DATABASE")".*.pre-deploy 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
fi
(cd "$APP_DIR" && node ace migration:run --force --no-schema-generate)
(cd "$APP_DIR" && node ace admin:sync)
log "database migrated, admin account synced"

# ---------------------------------------------------------------------------
# 7. (re)start: pm2 stops the old process with SIGINT, which saves every running world
# ---------------------------------------------------------------------------
if "$PM2" describe "$APP_NAME" >/dev/null 2>&1; then
  "$PM2" restart "$APP_NAME" --update-env >/dev/null
  log "pm2: restarted $APP_NAME"
else
  (cd "$APP_DIR" && "$PM2" start bin/server.js --name "$APP_NAME" --cwd "$APP_DIR" --kill-timeout 15000 >/dev/null)
  log "pm2: started $APP_NAME (run 'pm2 save' and 'pm2 startup' once so it comes back after a reboot)"
fi
"$PM2" save >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 8. health check
# ---------------------------------------------------------------------------
for i in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS "http://127.0.0.1:$PORT/up" >/dev/null 2>&1; then
    log "healthy on port $PORT"
    log "===== node deploy done: $AFTER ====="
    exit 0
  fi
  sleep 1
done
die "the server did not answer on http://127.0.0.1:$PORT/up after ${HEALTH_TRIES}s — see: $PM2 logs $APP_NAME --lines 50"
