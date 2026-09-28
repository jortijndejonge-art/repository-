# Hockey Club Platform

A field-hockey club management platform: squads, availability, matchday lineup planning with
smart suggestions, memberships and training. Ultimately it adds automated cross-club fixture
scheduling. The full plan (roadmap, business model, agent breakdown) lives in the design doc.

**Now:** web app (desktop + mobile browsers). **Later:** native iOS and Android apps.

## What's here (Phase 1)

| Path | What it is |
| --- | --- |
| `shared/contracts/` | **Frozen contract**: `types.ts` + `api-spec.yaml` (OpenAPI). Every layer codes against it. |
| `shared/engine/` | Pure TypeScript logic: formations (5/7/11-a-side) and **suggestion engine v1** (fair time / strongest / stamina, manager locks always win). |
| `shared/demo/` | The demo club (four teams, squads, fixtures), shared by the web app's demo mode and the database seed. |
| `backend/` | Node + Fastify API on PostgreSQL: magic-link sign-in, roles, players, availability, lineups, suggestions, sharing. |
| `app/` | React + Vite web app: sign-in, **My matches** for players, **Lineup planner** for managers. |
| `docs/tech-stack.md` | Stack decisions and the route to native apps. |
| `docs/deploy.md` | **Working in VS Code, and auto-deploying to www.solarbytez.com/myhockey.** |

### In the app

- **Sign in** with a one-tap email link, no passwords. Managers can invite imported players the same way.
- **Players** (My matches): upcoming matches for their teams, with "I'm in / Maybe / Can't make it" and
  whether they're starting or on the bench once the lineup is shared.
- **Managers** (Lineup planner):
  - The pitch follows the agreed design: attacking D at the top, own goal at the bottom, zone bands.
  - Drag and drop or tap-to-place. Placed players are 🔒 locked, so "Suggest lineup" plans around them.
  - Substitution plan, planned minutes, and a live availability panel.
  - Save, then share with selected players (they get an email).
- **Roles:** club admins manage every team, managers their own team, and players only see and set
  their own details.

## Getting started

Requires Node 20+.

### Demo mode (no server needed)

```bash
npm install
npm run dev        # http://localhost:5173 (use "Sign in as the coach" / "as a player")
```

Everything runs in the browser on demo data. This is the easiest way to show the committee.

### Full stack (real backend + database)

Needs PostgreSQL. The default connection is `postgres://hockey:hockey@localhost:5432/hockey`; set
`DATABASE_URL` to use another.

```bash
npm run db:seed              # create tables + load the demo club (wipes existing data!)
npm run dev:api              # API on http://localhost:3000
npm run dev:http -w app      # web app on http://localhost:5173, talking to the API
```

Sign in as `coach@example.com`. In development, the "email" is printed in the API's terminal and
the sign-in page shows the link directly. Players sign in with their own addresses, for example
`quinn.green.u12@example.com`.

### Checks

```bash
npm test           # engine tests + API integration tests (need Postgres; database: hockey_test)
npm run typecheck
npm run build
```

API tests wipe and re-seed `TEST_DATABASE_URL`
(default `postgres://hockey:hockey@localhost:5432/hockey_test`). Never point it at real data.

### Backend configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local `hockey` db | Postgres connection |
| `PORT` | `3000` | API port |
| `APP_URL` | `http://localhost:5173` | Web app address used in magic links |
| `NODE_ENV` | — | Set `production` in production (turns off dev sign-in links) |
| `MAGIC_LINK_TTL_MINUTES` / `SESSION_TTL_DAYS` | `15` / `30` | Link and session lifetimes |

## Deploying

Every push to `main` runs the tests and publishes the web app to
**www.solarbytez.com/myhockey** (`.github/workflows/deploy.yml`). One-time server setup is in
[docs/deploy.md](docs/deploy.md). To build for a sub-folder yourself:
`VITE_BASE=/myhockey/ npm run build`.

## Before going live

- Plug in a real email provider (`backend/src/services/mailer.ts`: only a console mailer exists).
- Add rate limiting on `/auth/magic-link`.
- Serve the built web app with a fallback to `index.html`, so `/auth/verify` links work.

## Next steps

1. Validate with one or two team managers (demo mode is fine for this).
2. CSV import from Spond / Teamo exports, plus bulk magic-link invites.
3. Squad management screen (add or edit players and ratings; the API already supports it).
4. Phase 2: training sessions, team calendar, Stripe memberships.
