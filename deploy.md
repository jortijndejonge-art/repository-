# Working in VS Code and deploying to www.solarbytez.com/myhockey

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
**https://www.solarbytez.com/myhockey**.

## What goes live

The site runs in **demo mode**: the full app works in the browser on the demo club, and data
resets when the page reloads. That's ideal for showing managers and the committee.

Real accounts and saved data need the backend (Node.js + PostgreSQL) running on the server, with
`/myhockey/api` forwarded to it. That's the next step. When it's running, set the repository
**variable** `VITE_API` to `http` (Settings → Secrets and variables → Actions → Variables) and the
site switches to real sign-in on the next deploy.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Actions says "Deploy skipped" | The `DEPLOY_*` secrets aren't set (step 5c). |
| `Permission denied (publickey)` | The public key isn't in the system user's `authorized_keys`, or `DEPLOY_USER` is wrong. |
| `rsync: command not found` | Install rsync on the server (step 5b.3). |
| Page loads but is blank / 404 on refresh | Check `.htaccess` was uploaded into `myhockey/`, and that the site runs Apache with `.htaccess` allowed (the Plesk default). If it's nginx-only, Plesk → Apache & nginx Settings → add `location /myhockey/ { try_files $uri /myhockey/index.html; }`. |
