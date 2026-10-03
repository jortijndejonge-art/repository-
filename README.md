# Hockey Club Platform

A field-hockey club management platform: squads, availability, matchday lineup planning with smart
suggestions, live matchday, training, chat, memberships and season scheduling across clubs. It runs in the
browser (desktop and phone) today; native iOS and Android apps come later. The full plan (roadmap, business
model, agent breakdown) lives in the design doc.

## What it does

**Everyone in the club**
- Sign in with an email and password (emailed one-tap links switch on once an email provider is connected).
- **Calendar** of matches and training for the teams you follow, with a **chat** on every event and unread counts.
- **Announcements** from managers, and **Membership** with plans and payments (payments switch on when Stripe is connected).

**Players and parents**
- **My matches** and **Training**: say if you can play or come, see the lineup once it is shared, read the coach's
  briefing and press "Got it".
- Parents get **My children** and answer for each child.

**Managers** (of one team) and **admins** (of the whole club)
- **Squad**: add and edit players, ratings and positions, link parents, create sign-ins, or **import a whole squad
  from a Spond, Teamo or Excel CSV** (columns are worked out for you; bad rows are listed, never fatal).
- **Fixtures** with clash warnings and suggested free times, **Training** with RSVPs and attendance, a **Stats** table
  (attendance, availability, minutes), automatic **availability chasing** in the match chat.
- **Lineup planner**: the pitch with drag-and-drop, formations for 5, 7 and 11-a-side, "Suggest lineup" (fair time,
  strongest or stamina), and the **substitution plan as a rotation chart** you edit by tapping or dragging.
- **Matchday**: a live clock, substitutions and minutes on the pitch, saved to each player's season total.
- **Club schedule**: every team's week, which pitch, what is free, anything clashing.
- Admins also get **Pitches** (weekly openings per age group) and the **Season planner**, which plans a whole
  season across clubs: who plays whom, on which pitch and date, home and away kept even, travel shared fairly.

## What's here

| Path | What it is |
| --- | --- |
| `shared/contracts/` | **The contract**: `types.ts` and `api-spec.yaml` (OpenAPI). Every layer codes against it. |
| `shared/engine/` | Pure TypeScript logic with tests: formations, the suggestion engine, the rotation chart, live-match minutes, CSV import parsing, clash and free-time finding, and the season scheduler. |
| `shared/demo/` | The demo club (four teams, squads, fixtures), shared by the web app's demo mode and the database seed. |
| `backend/` | Node and Fastify on PostgreSQL: sign-in, roles, and the services behind every screen (see `backend/src/services/`). Migrations are in `backend/migrations/` and run when the server starts. |
| `app/` | React and Vite web app. Screens are in `app/src/screens/`; the API client (real and in-browser mock) is in `app/src/api-client/`. |
| `qa/suggestion-backlog/backlog.md` | Every piece of work, newest first, with what was verified and what is not built yet. |
| `deploy.md` | Deploying to the server, the server's layout, and switching on Stripe and email. |
| `docs/tech-stack.md` | Stack decisions and the route to native apps. |

## Getting started

Requires Node 20+.

### Demo mode (no server needed)

```bash
npm install
npm run dev        # http://localhost:5173 (use "Sign in as the coach" / "as a player")
```

Everything runs in the browser on demo data. This is the easiest way to show the committee. Changes reset when
the page reloads.

### Full stack (real backend + database)

Needs PostgreSQL. The default connection is `postgres://hockey:hockey@localhost:5432/hockey`; set
`DATABASE_URL` to use another.

```bash
npm run db:seed              # create tables + load the demo club (wipes existing data!)
npm run dev:api              # API on http://localhost:3000
npm run dev:http -w app      # web app on http://localhost:5173, talking to the API
```

Sign in as `coach@example.com`. In development, the "email" is printed in the API's terminal and the sign-in
page shows the link directly. Players sign in with their own addresses, for example
`quinn.green.u12@example.com`.

Useful commands on a server (run in `backend/`): `npm run bootstrap` creates a real club and its admin,
`npm run add-member` adds a manager or parent, and `npm run set-password` sets or resets anyone's password.
See `deploy.md`.

### Checks

```bash
npm test           # engine tests, service tests, and API integration tests (the last need Postgres)
npm run typecheck
npm run build
```

API integration tests wipe and re-seed `TEST_DATABASE_URL` (default
`postgres://hockey:hockey@localhost:5432/hockey_test`). Never point it at real data.

### Backend configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local `hockey` db | Postgres connection |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the API listens |
| `APP_URL` | `http://localhost:5173` | The web app's public address, used in emailed links and Stripe return links |
| `NODE_ENV` | — | Set `production` in production (turns off dev sign-in links) |
| `MAGIC_LINK_TTL_MINUTES` / `SESSION_TTL_DAYS` | `15` / `30` | Link and session lifetimes |
| `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` | — | Real email through Resend (works where mail ports are blocked) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | — | Real email over SMTP instead |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | — | Switches membership payments on |

## Deploying

The server's layout and the exact steps are in [deploy.md](deploy.md). To build for a sub-folder yourself:
`VITE_BASE=/myhockey/ VITE_API=http npm run build`. The GitHub workflow (`.github/workflows/deploy.yml`) tests
every push and can deploy automatically once its secrets are added (see `deploy.md`).

## Security

Passwords are stored as salted scrypt hashes, never in clear. Wrong guesses are limited per email address and per
internet address, emailed sign-in links are throttled, a password change signs every other device out, every
route checks who is asking and what role they have (and the server tests assert it), request bodies are
validated, and the site is served with `nosniff`, framing and referrer headers. Never commit logins or keys: this
repository is public, and `.gitignore` already skips local bundles and files named like logins or credentials.

## Status and what is next

Phases 1 to 3 of the plan and the single-club part of Phase 4 are built, and the season planner works for one
club entering the others by hand. Waiting on accounts only the owner can create: Stripe (payments), an email
provider such as Resend (emailed links, reminders and announcements), and GitHub secrets for automatic deploys.
After that: other clubs joining with their own accounts and pitch times (Phase 4c), push notifications, and the
native apps. See the backlog for the detail.
