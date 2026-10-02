# Working in VS Code and deploying to www.solarbytez.co.uk/myhockey

The flow once set up:

```
edit in VS Code → Commit → Sync (push) → GitHub runs the tests → site updates automatically
```

The workflow in `.github/workflows/deploy.yml` runs the tests on every push. On pushes to
`main` it also builds the app and uploads it to `…/httpdocs/myhockey` on your server. If a test
fails, nothing is deployed.

---

## 1. Install the tools (once)

- **Git**: https://git-scm.com/downloads
- **Node.js 22 LTS**: https://nodejs.org
- **VS Code**: https://code.visualstudio.com

## 2. Get the code onto your computer

**If the code is already on GitHub**, open VS Code and go to **Source Control → Clone
Repository**. Paste `https://github.com/jortijndejonge-art/repository-`, then choose a folder.

**If it isn't on GitHub yet**, use the `hockey-app.bundle` file Claude sent you. In a terminal:

```bash
git clone hockey-app.bundle myhockey
cd myhockey
git remote set-url origin https://github.com/jortijndejonge-art/repository-.git
git branch -m main                 # use "main" as your branch
git push -u origin main            # uses your own GitHub login
```

## 3. Open and run it

1. VS Code → **File → Open Folder…** → the project folder.
2. **Terminal → New Terminal**, then:

   ```bash
   npm install
   npm run dev
   ```

3. Open http://localhost:5173. Use "Sign in as the coach" or "as a player" (demo mode, no
   database needed).

## 4. Commit and push from VS Code

1. Make your changes. Changed files appear in the **Source Control** panel (the branch icon).
2. Type a message, e.g. "Change pitch colours", and click **Commit**.
3. Click **Sync Changes** to push to GitHub.
4. On GitHub, open the **Actions** tab to watch the tests and the deploy. A green tick means the
   site is updated.

## 5. Connect GitHub to your website (once)

The workflow uploads over SSH. On an IONOS VPS with Plesk:

### a. Make a deploy key (on your computer)

```bash
ssh-keygen -t ed25519 -f myhockey_deploy -N "" -C "github-deploy-myhockey"
```

This creates `myhockey_deploy` (private key, which goes to GitHub) and `myhockey_deploy.pub`
(public key, which goes on the server).

### b. Allow that key on the server (Plesk)

1. **Websites & Domains → solarbytez.com → Hosting & DNS → Hosting Settings** (or
   **Web Hosting Access**). Set **SSH access** to `/bin/bash` and note the **system user name**.
2. Add the contents of `myhockey_deploy.pub` to that user's `~/.ssh/authorized_keys`. You can use
   the Plesk **SSH Keys** extension, or run this from a terminal that can already reach the server:
   ```bash
   ssh-copy-id -i myhockey_deploy.pub SYSTEMUSER@solarbytez.com
   ```
3. Make sure `rsync` is installed on the server (`rsync --version`). On most Plesk VPSes it already
   is; if not, `apt install rsync` as root.
4. The site folder is usually `/var/www/vhosts/solarbytez.com/httpdocs`. The app goes in the
   `myhockey` folder inside it, which the workflow creates for you.

### c. Add the secrets on GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | `solarbytez.com` (or the server's IP) |
| `DEPLOY_USER` | the Plesk system user from step b |
| `DEPLOY_SSH_KEY` | the whole contents of the private key file `myhockey_deploy` |
| `DEPLOY_PATH` | `/var/www/vhosts/solarbytez.com/httpdocs/myhockey` |
| `DEPLOY_PORT` | only if SSH isn't on port 22 |

Then delete the local `myhockey_deploy` file, or keep it somewhere safe. Never commit it.

> **Safety:** the upload replaces everything inside `DEPLOY_PATH`. The workflow refuses to run
> unless the path ends in `/myhockey`, so it can't overwrite the rest of solarbytez.com.

### d. Deploy

Push anything to `main`, or go to **Actions → Test and deploy → Run workflow**. Then open
**https://www.solarbytez.co.uk/myhockey**.

## Automatic deploy on every push to `main` (the plan)

Every push to `main` runs the tests and, if they pass, builds the app and uploads it to the
server. There is nothing to do by hand after the one-time setup below. Pushes to other branches
and pull requests only run the tests.

### Real server details (IONOS VPS `77.68.51.71`, see `C:\programming\SERVER-PATHS.md`)

**Done on 2026-10-02:** the folder `/var/www/myhockey` and the Apache route below are already set up
(config backup: `vhost_ssl.conf.bak-myhockey`). Only the GitHub secrets remain.

The server is not a plain Plesk `httpdocs` site. Apache proxies each path to a pm2 Node app, and
`/` goes to the marketing site, so `/myhockey` has to be added as its own route. The deploy
key is `~/.ssh/solarbytez_deploy`, which logs in as the limited user `deploy`. That user has no
access outside a few folders and cannot edit Apache, so the route is set up once as root:

```bash
# on the VPS, as root
mkdir -p /var/www/myhockey && chown deploy:deploy /var/www/myhockey
```

Then add this to the Apache config for the site (`/var/www/vhosts/system/<domain>/conf/vhost_ssl.conf`,
and `vhost.conf` if plain http is served), **above** the `/` proxy rule, and reload Apache
(`plesk repair web -y` or `systemctl reload apache2`):

```apache
ProxyPass /myhockey !
Alias /myhockey /var/www/myhockey
<Directory /var/www/myhockey>
    Require all granted
    Options -Indexes
    FallbackResource /myhockey/index.html
</Directory>
```

GitHub secrets (repo → Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | `77.68.51.71` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | full contents of `C:\Users\<you>\.ssh\solarbytez_deploy` (the private key) |
| `DEPLOY_PATH` | `/var/www/myhockey` |

Once these are set, the next push to `main` goes live at https://www.solarbytez.co.uk/myhockey (the server only serves solarbytez.co.uk; solarbytez.com does not point at it).
Check progress under the repo's **Actions** tab.

## What goes live

The site runs in **demo mode**: the full app works in the browser on the demo club, and data
resets when the page reloads. That's ideal for showing managers and the committee.

Real accounts and saved data need the backend (Node.js + PostgreSQL) running on the server, with
`/myhockey/api` forwarded to it. That's the next step. When it's running, set the repository
**variable** `VITE_API` to `http` (Settings → Secrets and variables → Actions → Variables) and the
site switches to real sign-in on the next deploy.

## The backend on the server (set up 2026-10-02)

The API runs on the VPS, separate from the other apps:

| Part | Where |
| --- | --- |
| Code | `/opt/myhockey` (a clone of this repo; update with `git pull`, then `pm2 restart myhockey-api`) |
| Process | pm2 app `myhockey-api` on `127.0.0.1:3010` |
| Database | its own Postgres in Docker, `myhockey-postgres`, on `127.0.0.1:5433` (memory capped at 256 MB; the Parts Picker database is untouched) |
| Settings | `/etc/myhockey.env`, root only: `DATABASE_URL`, `APP_URL`, `MAIL_FROM`, and later the Stripe keys |
| Apache | `/myhockey/api` is proxied to port 3010 in `vhost_ssl.conf` (backup `vhost_ssl.conf.bak-myhockey-api`) |

Migrations apply automatically when the backend starts. Sign-in emails are sent by the server's own
mail service (`MAIL_FROM`); they might land in spam, so check there. Change `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER` and `SMTP_PASS` in the settings file to use a mail provider instead.

Create the real club (once), on the server in `/opt/myhockey`:

```bash
set -a; . /etc/myhockey.env; set +a
npm run bootstrap -w backend -- --club "Club name" --first Jo --last Bloggs --email you@example.com   --team "U12 Girls:U12:7" --team "Men's 2s:Adult:11"
```

Then switch the website from demo to the real backend by setting the repository **variable**
`VITE_API` to `http` (Settings → Secrets and variables → Actions → Variables) and redeploying.
Until you do, the website stays in demo mode.

## Switching on Stripe payments (later)

Membership payments are built and tested, and stay **off** until a Stripe account is connected.
Until then the Membership tab says "Online payments aren't switched on yet", and the demo site
simulates payments. When you have a Stripe account:

1. In the Stripe dashboard (start in **test mode**), copy the secret key (`sk_test_…`).
2. Developers → Webhooks → add an endpoint `https://www.solarbytez.co.uk/myhockey/api/v1/webhooks/stripe`
   listening for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed` and
   `customer.subscription.deleted`. Copy its signing secret (`whsec_…`).
3. Set these on the server where the backend runs (the backend has to be hosted first, see
   "What goes live"): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_URL` (the public address
   of the app, e.g. `https://www.solarbytez.co.uk/myhockey`, used for the return links and reminder
   emails). Restart the backend.
4. Test with Stripe's test card `4242 4242 4242 4242`, then swap in the live keys.

How it works: a member picks a plan and is sent to Stripe Checkout (a recurring subscription in GBP,
monthly, every 3 months or yearly). Stripe then calls the webhook, which records the payment and
sets the membership's status and next due date. Members are emailed a reminder when a payment is due
within a week or overdue (checked every six hours, at most one email per six days).

Not built yet: taking the platform's small transaction fee. That needs Stripe Connect, so each
club has its own connected Stripe account. It is a separate step once you have a Stripe account.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Actions says "Deploy skipped" | The `DEPLOY_*` secrets aren't set (step 5c). |
| `Permission denied (publickey)` | The public key isn't in the system user's `authorized_keys`, or `DEPLOY_USER` is wrong. |
| `rsync: command not found` | Install rsync on the server (step 5b.3). |
| Page loads but is blank / 404 on refresh | Check `.htaccess` was uploaded into `myhockey/`, and that the site runs Apache with `.htaccess` allowed (the Plesk default). If it's nginx-only, Plesk → Apache & nginx Settings → add `location /myhockey/ { try_files $uri /myhockey/index.html; }`. |
