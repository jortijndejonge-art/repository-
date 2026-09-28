# Hockey Club Platform

A field-hockey club management platform: squads, availability, matchday lineup planning with
smart suggestions, memberships and training. Ultimately it adds automated cross-club fixture
scheduling. The full plan (roadmap, business model, agent breakdown) lives in the design doc.

**Now:** web app (desktop + mobile browsers). **Later:** native iOS and Android apps.

## What's here (Phase 1 start)

| Path | What it is |
| --- | --- |
| `shared/contracts/` | **Frozen contract**: `types.ts` + `api-spec.yaml` (OpenAPI). Every layer codes against it. |
| `shared/engine/` | Pure TypeScript logic with no UI and no server: formations (5/7/11-a-side) and **suggestion engine v1** (fair time / strongest / stamina, manager overrides always win). Tested. |
| `app/` | React + Vite web app: the **clickable lineup-planner prototype** for committee demos. Runs on a mock API client with demo data, so no backend is needed yet. |
| `docs/tech-stack.md` | Stack decisions and the route to native apps. |

### Lineup planner prototype

- Pitch drawn per the agreed design: our team attacks upwards, the attacking D is at the top,
  our goal and D are at the bottom, and labelled forwards / midfield / defence bands.
- 5-, 7- and 11-a-side with a choice of formations per format.
- Drag and drop with mouse or touch, or tap a player and then tap where they go. Players you place
  are 🔒 locked, so "Suggest lineup" plans around your choices.
- Substitution plan, planned minutes per player, and availability toggles. When a player drops
  out, the engine re-plans around your locked positions.
- Share to selected players, or copy the lineup as text.

## Getting started

Requires Node 20+.

```bash
npm install
npm run dev        # web app on http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
npm test           # suggestion-engine tests
npm run typecheck
npm run build      # production build in app/dist
```

## Next steps

1. Validate the prototype with one or two team managers.
2. Backend (Agents A/B): Node + Postgres with the data model from `types.ts`, magic-link auth, and
   the endpoints in `api-spec.yaml`. Then swap the mock client in `app/src/api-client` for real HTTP.
3. Player-facing screens: magic-link sign-in and marking your own availability.
4. CSV import from Spond / Teamo exports.
