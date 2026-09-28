# Tech stack decisions

## Goal
Ship web apps first (desktop and phone browsers), then native iOS and Android, without rewriting
the product.

## Decisions

| Area | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | One language across web, backend and (later) React Native. The shared contract is plain TS types. |
| Web app | React + Vite | Fast, simple, and responsive in the browser. It can become an installable PWA with little extra work. |
| Native (later) | React Native (Expo) | Reuses `shared/contracts`, `shared/engine` and the API client unchanged. Only the screens are rebuilt with native components. This is why React is picked over Flutter here: Flutter would mean rewriting the engine and client in Dart. |
| Backend | Node.js on the IONOS VPS (Plesk) | Plays to existing strengths. |
| Database | PostgreSQL | Relational integrity for clubs → teams → members → fixtures. The Phase 4 scheduler depends on it. |
| Auth | Magic links (email/SMS) | No passwords, far higher sign-up rate for squads. |
| Payments | Stripe Billing (Phase 2) | Never touch card data. The transaction-fee revenue model sits on top. |
| Notifications | FCM push + email | Availability chasing, briefings, lineup sharing. |
| Scheduling engine (Phase 4) | OR-Tools constraint solver | Standard for sports timetabling. Probably a small Python service next to the Node API. |

## How code is shared across platforms

```
shared/contracts  ← types + OpenAPI (frozen)
shared/engine     ← pure logic: formations, suggestion engine
      ↑                 ↑
   app/ (web)      backend/ (Node)      mobile/ (React Native, later)
```

Nothing in `shared/` may import from React, the DOM, Node APIs or a database. That rule is what
lets it run unchanged in the browser, on the server and on phones.

## Known v1 limitations (suggestion engine)

- Keepers play the whole match; there is no keeper rotation yet.
- Substitutions happen on a fixed grid (twice per quarter), so with only one or two subs "fair
  time" cannot perfectly equalise minutes.
- Starting positions are chosen greedily, not by a globally optimal assignment. That is fine at
  squad sizes, and worth revisiting when live matchday minutes feed back in (Phase 3).
