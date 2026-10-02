# Suggestion backlog

Maintained per Part 3 (Agent G — Improvement scout) of the master plan. Anyone
reviewing the app — a build agent, a tester, or you — can propose an idea
here. **New entries always start as `Proposed`.** Only the project owner
marks something `Approved`; nothing in this file authorizes work by itself.

Rejected items are kept for the record, not deleted — just move them to the
"Rejected" state below rather than removing the entry.

## Owner constraints

- **Pitch screen is frozen (owner, 2026-10-02):** the pitch / lineup screen as it looks now
  (half pitch, zone bands, tokens, goal, halfway line) must not be changed. Do not propose or
  build visual or layout changes to it. Bug fixes the owner asks for are fine.

## Statuses

- `Proposed` — newly logged, not yet reviewed
- `Approved` — owner has signed off; ready to schedule
- `Rejected` — owner decided against it (kept for history, see rationale)
- `Deferred` — worth doing, but not now

## Entry format

```
## BL-NNNN — <short title>
- **Date:** YYYY-MM-DD
- **Source task:** <plan task id, e.g. D1, or "n/a">
- **Idea:** <what's being proposed>
- **Rationale:** <why it's worth doing>
- **Effort estimate:** S / M / L
- **Owning agent:** <A–G, or "unassigned">
- **Status:** Proposed
```

Next free id: **BL-0011**

---

## BL-0010 — Training sessions: schedule, RSVP and attendance
- **Date:** 2026-10-02
- **Source task:** Phase 2 (training session management, attendance tracking)
- **Idea:** Managers schedule training per team, players RSVP (in / maybe / can't make it), and managers tick who actually attended.
- **Rationale:** Master plan Phase 2 makes the app the club's day-to-day tool, not just a matchday one.
- **Effort estimate:** M
- **Owning agent:** A/B (migration 006, routes), C (Training tab)
- **Status:** Approved — owner commissioned this directly ("continue with the backlog").
- **Outcome (2026-10-02):** Done, committed in 7712e87 and live. Verified in the browser (demo) and against the live API; DB integration tests added but only run in CI. Not built yet: a combined team calendar of matches and training, attendance stats across the season, and notifying players about new sessions (needs working email).

## BL-0009 — Fixtures screen
- **Date:** 2026-10-02
- **Source task:** Phase 4a (single-club fixture admin, manual entry)
- **Idea:** Managers add, edit and delete a team's matches.
- **Rationale:** The lineup planner and availability need fixtures, and the club had no way to create them.
- **Effort estimate:** M
- **Owning agent:** B (routes), C (screen)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Done, committed in 0242c5a and live. The lineup planner still plans only a team's next match; a match picker there was left out because the lineup screen is frozen.

## BL-0007 — Squad screen: add and edit players
- **Date:** 2026-10-02
- **Source task:** B3 / C-layer gap (player profiles and squad management, Phase 1)
- **Idea:** A Squad tab where managers add players and edit name, shirt number, positions (preferred first) and skill/stamina ratings.
- **Rationale:** Master plan Phase 1 lists squad management and player profiles; the API existed but no screen did.
- **Effort estimate:** S–M
- **Owning agent:** C (screen and API client), reusing B's endpoints
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Done, committed in 72b7056. Verified in the browser (add, edit, shows in the lineup planner). No change to the pitch screen.

## BL-0006 — Membership payments with Stripe (built, switched off until Stripe keys are added)
- **Date:** 2026-10-02
- **Source task:** C5 (membership / payment UI), A5, Phase 2 membership management
- **Idea:** Membership tab for every member (plans, your status, next payment, Join / Pay) and for admins a form to add plans. Backend: Stripe Checkout subscriptions (monthly, 3-monthly, yearly in GBP), a signature-verified webhook that records payments and updates membership status and next due date, and automatic payment-due reminder emails.
- **Rationale:** The business plan earns on payment transaction fees; this is the payments foundation. The owner has no Stripe account yet, so it is built to stay off until keys are set.
- **Effort estimate:** L
- **Owning agent:** B (payments service, routes), A (repository, migration 004), C (Membership screen)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Done. Backend and screen built, with 16 payment tests (signature check, checkout request, webhook route, idempotent payments, reminders). Not run against real Stripe. Still to do once there is an account: set the keys (see deploy.md), and the platform's transaction fee, which needs Stripe Connect. Migration 004 must be applied on deploy.

## BL-0005 — Live drag preview: player follows the pointer, red when too close
- **Date:** 2026-10-01
- **Source task:** D3 (draggable player tokens), follow-up to BL-0004
- **Idea:** While dragging, the player's own token (circle and name) moves with the pointer instead of a small text ghost, so you can see exactly where it will land. Over open grass, its circle turns red whenever dropping there would touch another player, and the drop is then refused. It snaps to the clamped spot at halfway or the side lines so the preview matches where it would land. Swapping onto a player and dropping on the bench keep working.
- **Rationale:** Owner feedback: "it is a bit hard to see where you're dragging the player".
- **Effort estimate:** S–M
- **Owning agent:** D (implementation), reviewed by E (functional) and F (visual)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Done, committed in 8c43cd9.
  - **Process:** a subagent (D) built it and an independent subagent (E+F) reviewed it twice.
  - **Review 1 — PASS WITH FIXES, six findings, all fixed:**
    - On touch the token is lifted 48px above the finger, and the drop uses the lifted point.
    - Off-side drags snap to the side line within 60px of the pitch.
    - Drops that would do nothing show a faded, grey look.
    - The preview is resolved once per pointer move and stored outside React, so the page doesn't re-render while dragging: 0.1ms per move, down from 5.9ms.
    - Sizes are measured when the drag starts, with no hard-coded px.
    - The floating token doesn't show the out-of-position ring.
  - **Review 2 — PASS WITH FIXES, two regressions found and fixed by the orchestrator:**
    - A touch release in the bench's top edge became a grass move. Now, if the finger is on the bench, it's a bench drop.
    - Scrolling mid-drag left the preview stale. It now re-resolves on scroll.
  - **Verification:** in Playwright with CDP touch at 390px; the drop always matches the last preview.

## BL-0004 — Drag players to adjust a formation's positions
- **Date:** 2026-10-01
- **Source task:** D3 (draggable player tokens)
- **Idea:** Drag a player onto open grass to move that *position* in the formation. Adjusted spots belong to the position, not the player, so they hold through swaps, re-suggestions and formation switches. "Save positions" stores them per team, and "Reset positions" goes back to the automatic layout. Works for built-in and custom formations. A drop that would overlap another player, or leave our half, is refused or clamped.
- **Rationale:** Owner-requested directly ("make the players draggable on the pitch if I want to adjust"; adjustments edit the formation, with save and reset).
- **Effort estimate:** M
- **Owning agent:** D (UI), A/B (`formation_layouts` table, routes)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-01):** Done, committed in 8c43cd9. Verified in the mock-backed app: drag, save, swap, formation switch, overlap refusal and reset all work. The backend integration tests are written but need a Postgres to run; migration `003_formation_layouts.sql` must be applied on deploy.

## BL-0003 — Keep rows clear of the 23 m line
- **Date:** 2026-10-01
- **Source task:** F2 review of BL-0001
- **Idea:** Rows currently land on the 23 m line by chance (e.g. a 3-2-3-2's defensive-midfield row straddles it). Snap FWD/MID rows fully above it and DEF rows fully behind it.
- **Rationale:** Visual reviewer flagged it as reading like an accident. Measured cost: it squeezes the midfield band so much that tokens would drop to ~7.9% of pitch width (from 9%). Not done for that reason.
- **Effort estimate:** S
- **Owning agent:** D
- **Status:** Proposed — but already implemented as part of BL-0001's redesign (rows now stay clear of the line; the cost was far smaller than estimated once our half was drawn taller). Owner to confirm or reject.

## BL-0002 — Zone labels don't match where players stand
- **Date:** 2026-10-01
- **Source task:** F2 review of BL-0001; D1
- **Idea:** Forwards stand in the band labelled "MIDFIELD" and nobody ever stands in "ATTACK" (the opposition 23 m area shown for orientation). Rename or drop the band labels, e.g. relabel our half's bands by where the lines actually sit.
- **Rationale:** Real lineup graphics don't label zones the lineup never uses. Touches the original pitch-design requirement for labelled bands, so it's an owner decision.
- **Effort estimate:** S
- **Owning agent:** D
- **Status:** Proposed

## BL-0001 — Uniform, perfectly-fitting player tokens across every formation
- **Date:** 2026-10-01
- **Source task:** D1/D2 (Pitch component, squad-format switch); F2 (token readability at 5/7/11, crowding)
- **Idea:** Audit and fix on-pitch player token sizing so every player renders at the same size within a lineup, never overlaps or spills outside the pitch at any format (5/7/11-a-side) or formation (built-in or custom), and the overall look matches real lineup/formation graphics as closely as possible. Backed by research into how professional apps (FotMob, Sofascore, WhoScored, broadcast graphics) size and space starting-XI tokens.
- **Rationale:** Owner-directed directly in conversation — current per-format fixed token sizes (from BL groundwork during the custom-formation build) were tuned by eye, not verified against every possible band width (e.g. a custom formation with a wide back line), and haven't been benchmarked against real-world lineup graphic conventions.
- **Effort estimate:** M
- **Owning agent:** D (implementation), F (visual review)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-01):** Done, committed in 8c43cd9. Fixed a double y-mapping bug in the custom-formation generator that made a 3-2-3-2 midfielder and forward touch. Forwards now sit a full token height below halfway. Rows are spaced evenly from halfway down to the keeper, as real lineup graphics do. Tokens are one size per format (5-a-side 64px, 7-a-side 60px, 11-a-side 49px at the test viewport), computed as the largest size at which every built-in and every saveable custom formation fits, counting the name label and lock, not just the disc. Custom formations are capped to realistic shapes: 5/7-a-side 3 lines, 11-a-side 4; at most 3/4/5 per line. Generated names are now real ones (LCB, LDM, CAM…). Independent visual review found no overlaps; its open suggestions are BL-0002 and BL-0003.
- **Follow-up (owner, 2026-10-01):** One token size for every format: the 11-a-side size, 9% of pitch width (49px at the test viewport). Players in a row are now drawn exactly level, with the built-in staggers dropped. The per-format line limits existed only to keep the bigger 5/7-a-side tokens fitting, so they're gone: every format allows up to 4 lines and 5 per line, and a 7-a-side diamond is valid again.
- **Follow-up (owner, 2026-10-01):** A custom 2-3-2-3 "looked nothing like the formation" because its pairs stood nearly as wide as its trios, which read as a checkerboard. Generated lines now use real-world widths: a pair is a tight central pair at 38/62 (LCB/RCB, LCM/RCM, LAM/RAM), and lines of 3+ spread to the flanks. Built-in formations keep their own hand-tuned widths.
- **Follow-up (owner: "it looks like crap", 2026-10-01):** Redesigned after a critical self-review and an independent review subagent:
  - **Tokens:** filled tokens are now just the number and name, as on real lineup cards. The position badge is gone; position is still shown on hover and to screen readers. The lock only shows on hover, on selection, or when locked.
  - **Proportions:** everything scales together, which fixed the phone view where the number and badge overlapped.
  - **Taller half:** our half is drawn 1.3× taller than scale (owner's choice), and the inner markings are softer so they sit behind players.
  - **Widths:** every formation, built-in included, now uses one fixed set of positions per row size, so a pair is always the same central pair.
  - **Rows and the 23m line:** rows are evenly spaced, and a row is moved only if the 23m line would cut through it.
  - **Out-of-position marker:** now dashed red. Amber is the keeper's colour.
  - **Verified:** 51px desktop / 33px phone everywhere; no touching or 23m crossings at either width.
  - **This supersedes BL-0003.**

<!-- Add new entries above this line, newest first. -->
