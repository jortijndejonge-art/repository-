#!/usr/bin/env bash
# MyHockey auto-deploy. A systemd timer runs this every 2 minutes on the server.
# If GitHub's main has a new commit, it updates /opt/myhockey, builds the web
# app, restarts the backend, checks it's healthy, then publishes the website.
# If anything fails it goes back to the previous version and skips that commit
# until a newer one arrives. See deploy/server/README.md.
set -euo pipefail

# Settings (override in /etc/myhockey-deploy.conf).
REPO_DIR=/opt/myhockey
WEB_DIR=/var/www/myhockey
WEB_OWNER=deploy:deploy
BRANCH=main
PM2_APP=myhockey-api
HEALTH_URL=http://127.0.0.1:3010/api/v1/health
SITE_BASE=/myhockey/
STATE_DIR=/var/lib/myhockey-deploy
INSTALL_CMD="npm ci --no-audit --no-fund"
BUILD_CMD="npm run build"
HEALTH_TIMEOUT=60
CONF=${MYHOCKEY_DEPLOY_CONF:-/etc/myhockey-deploy.conf}
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
RESTART_CMD=${RESTART_CMD:-"pm2 restart $PM2_APP"}

log() { echo "[myhockey-deploy] $*"; }

# Only one run at a time.
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch --quiet origin "$BRANCH"
old=$(git rev-parse HEAD)
new=$(git rev-parse "origin/$BRANCH")
[ "$old" = "$new" ] && exit 0

# A commit that already failed is skipped until main moves on.
if [ "$(cat "$STATE_DIR/failed" 2>/dev/null || true)" = "$new" ]; then
  exit 0
fi

# Never overwrite changes someone made by hand on the server.
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Not deploying: $REPO_DIR has local changes. Commit or undo them first (git status)."
  exit 1
fi

log "Deploying ${new:0:7} (was ${old:0:7})"

install_and_build() {
  $INSTALL_CMD && VITE_BASE="$SITE_BASE" VITE_API=http $BUILD_CMD
}

healthy() {
  local waited=0
  until curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; do
    sleep 2
    waited=$((waited + 2))
    [ "$waited" -ge "$HEALTH_TIMEOUT" ] && return 1
  done
}

restarted=no

roll_back() {
  log "Rolling back to ${old:0:7}"
  echo "$new" >"$STATE_DIR/failed"
  git reset --quiet --hard "$old"
  # The backend only needs restarting if this run restarted it.
  if install_and_build && { [ "$restarted" = no ] || { $RESTART_CMD >/dev/null && healthy; }; }; then
    log "Back on ${old:0:7}. Commit ${new:0:7} will be skipped until a newer one is pushed."
  else
    log "WARNING: the previous version didn't come back healthy either. Check: pm2 logs $PM2_APP"
  fi
  exit 1
}

# Fast-forward only: refuse if main's history was rewritten.
if ! git merge --quiet --ff-only "origin/$BRANCH"; then
  log "Not deploying: main can't be fast-forwarded from ${old:0:7}. Fix by hand (git status)."
  exit 1
fi

if ! install_and_build; then
  log "Install or build failed."
  roll_back
fi

# Backend first (database migrations run as it starts), then check it answers.
restarted=yes
if ! $RESTART_CMD >/dev/null || ! healthy; then
  log "Backend didn't come back healthy within ${HEALTH_TIMEOUT}s."
  roll_back
fi

# Website last, so it never runs ahead of the backend it talks to.
mkdir -p "$WEB_DIR"
# --checksum: index.html is the same size every build, so compare contents, not size and time.
rsync -a --delete --checksum app/dist/ "$WEB_DIR/"
chown -R "$WEB_OWNER" "$WEB_DIR" 2>/dev/null || true
rm -f "$STATE_DIR/failed"
log "Deployed ${new:0:7}: $(git log -1 --format=%s)"
