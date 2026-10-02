# Automatic deploy on the server

A timer on the VPS checks GitHub every 2 minutes. When `main` has a new commit it:

1. updates `/opt/myhockey` (fast-forward only),
2. installs packages and builds the website (`VITE_BASE=/myhockey/`, `VITE_API=http`),
3. restarts the backend (`pm2 restart myhockey-api`; database migrations run as it starts) and waits
   until `http://127.0.0.1:3010/api/v1/health` answers,
4. only then copies the new website into `/var/www/myhockey`.

If the build fails, or the backend doesn't come back healthy within 60 seconds, it goes back to the
previous version (restarting that if it had restarted the backend). It then skips the bad commit
until a newer one is pushed. It never deploys over files someone changed by hand in `/opt/myhockey`,
and never deploys if `main`'s history was rewritten. Nothing on GitHub needs access to the server.

## Install (once, as root on the VPS)

```bash
cd /opt/myhockey
git fetch origin main                      # must work without asking for a password

# Install the script and the timer straight from GitHub's main. Don't `git pull` here:
# the first timer run should see the new commit and do the whole deploy.
git show origin/main:deploy/server/myhockey-autodeploy.sh > /usr/local/bin/myhockey-autodeploy
chmod 755 /usr/local/bin/myhockey-autodeploy
git show origin/main:deploy/server/myhockey-deploy.service > /etc/systemd/system/myhockey-deploy.service
git show origin/main:deploy/server/myhockey-deploy.timer   > /etc/systemd/system/myhockey-deploy.timer

# The timer uses this PATH: /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
which node npm pm2 git rsync curl flock
```

If any of those aren't found on that PATH (for example Node installed with nvm), tell the script
where they are in `/etc/myhockey-deploy.conf`:

```bash
echo 'export PATH=/root/.nvm/versions/node/v22.12.0/bin:$PATH' > /etc/myhockey-deploy.conf
```

Then run it once by hand, watch it, and switch the timer on:

```bash
systemctl daemon-reload
systemctl start myhockey-deploy.service          # the first deploy: takes a minute or two
journalctl -u myhockey-deploy -n 50 --no-pager   # should end with "Deployed <commit>: <message>"
systemctl enable --now myhockey-deploy.timer
```

## Day to day

| To… | Run |
| --- | --- |
| See what it did | `journalctl -u myhockey-deploy -n 50 --no-pager` |
| See when it runs next | `systemctl list-timers myhockey-deploy` |
| Deploy right now | `systemctl start myhockey-deploy.service` |
| Pause automatic deploys | `systemctl stop myhockey-deploy.timer` (start it again to resume) |
| Retry a commit it skipped | `rm /var/lib/myhockey-deploy/failed` |

Settings (paths, pm2 app name, health URL, timeout) can be overridden in `/etc/myhockey-deploy.conf`;
see the top of `myhockey-autodeploy.sh`. If the script itself changes on `main`, re-run the install
lines for it: the timer runs the copy in `/usr/local/bin`, not the one in the repo.

**Don't also set the `DEPLOY_*` secrets on GitHub.** That would add a second deployer that uploads
the website without updating the backend. With this timer, GitHub only runs the tests.
