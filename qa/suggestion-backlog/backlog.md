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

Next free id: **BL-0024**

---

## BL-0023 — Pitches, weekly openings, clash warnings and a club schedule (Phase 4a)
- **Date:** 2026-10-03
- **Source task:** Plan, Phase 4a: "each club publishes pitch availability: which slots, which age groups, which times; manual/assisted fixture entry with conflict detection; manage all age groups in one place"
- **Idea:** Admins add the club's pitches and the weekly times each is open, per age group (Pitches tab). Home matches can be booked on a pitch. Adding or editing a match checks, as you type, for a pitch already booked then (including 10 minutes' turnaround), the team already playing or training, and a time outside the pitch's openings for that age group; each is explained in plain words, and the manager can still "Save anyway". The form suggests the earliest free times for the team's age group and match length, one tap to take one. A Club schedule tab shows every team's week with the pitch, free time left in each opening, and any clash highlighted.
- **Rationale:** This proves the data model (pitches, slots, age groups, bookings) before the season scheduler automates it, as the plan says.
- **Effort estimate:** L
- **Owning agent:** A/B (migration 013, schedule service and routes), C (Pitches, Club schedule, fixture form), shared engine (clash and free-time maths)
- **Status:** Approved — continuing the plan, as the owner asked.
- **Outcome (2026-10-03):** Done, committed in 9b477de and live. 14 engine tests (including UK summer and winter time, and the day the clocks change), 6 service tests, a live run with throwaway data (pitch and opening created; admin-only enforced; same-time booking refused with the reason; 50 minutes later is fine; 15:00 flagged as outside the opening; forcing works; the club schedule is for managers only), and tried in a browser. The pitches start empty, so nothing about existing matches changes until a club adds them. Times use the club's time zone, Europe/London for now. Not built yet: the automatic season scheduler (Phase 4b), away-match travel, and pitch bookings for training.

## BL-0022 — Automatic availability chasing
- **Date:** 2026-10-03
- **Source task:** Plan, Phase 3: "Automated availability chasing: reminders to players who haven't responded; manager sees a confirmed-count view"
- **Idea:** The server checks every three hours and, for any match in the next three days where players (or their parents) have not answered, posts a reminder in that match's chat naming who it is still waiting on. Each match is reminded at most once a day. Managers also get a "Remind N who haven't replied" button in the Availability card, which can be pressed again after an hour. When a real email provider is connected, the same reminder is also emailed to those players and their parents (one email each, even for a parent with two children waiting). The confirmed-count view ("9 confirmed, need 2 more") already existed.
- **Rationale:** Managers should not have to chase by hand. The chat is the in-app channel while email is not yet set up.
- **Effort estimate:** M
- **Owning agent:** B (chase service, routes, scheduled check), C (button)
- **Status:** Approved — continuing the plan, as the owner asked.
- **Outcome (2026-10-03):** Done, committed in 630bdce and da220a4, live. 8 service tests. A live check with a throwaway match found a real bug (the server tried to email through its own mail service, which cannot send, and that made the request fail after the chat reminder was posted); fixed so a failed email can never fail the reminder, and "email enabled" now needs a real provider (a Resend key or an explicit SMTP host). Re-checked live: reminder posted and visible to a parent, repeat refused, parent refused (403). Note: the automatic check now runs on the live server, so real teams' match chats will show reminders for matches in the next three days. Not built yet: chasing training RSVPs, and nudging in the phone app itself (needs push notifications).

## BL-0021 — Bulk spreadsheet import (Spond, Teamo, Excel)
- **Date:** 2026-10-03
- **Source task:** Plan, "Club onboarding and migration": a forgiving bulk CSV importer, "the single biggest lever" for winning clubs
- **Idea:** On the Squad screen, Import takes a CSV (upload or paste) and works out the columns from their headings (first/last name or full name, email, phone, team, shirt number, position, parent email and name), copes with semicolons, tabs, quotes and a byte-order mark, tidies shouty names, reads "Goalkeeper / Defender" as positions, and lets the manager correct any column. A preview shows exactly who will be added; lines that cannot be used are listed with their line number and the reason, and never stop the rest. A Team column sends each person to the matching team. An "email is the parent's" option links the address as a parent (children often share a parent's email). New parents (and, optionally, players with an email) get a first password, shown once with a download.
- **Rationale:** The plan says a club that has to hand-type 200 members will never switch. This is the white-glove import turned into a self-service tool.
- **Effort estimate:** L
- **Owning agent:** B (import service, route), C (Import panel), shared engine (parsing)
- **Status:** Approved — continuing the plan, as the owner asked.
- **Outcome (2026-10-03):** Done, committed in c5532ab and live. 17 engine tests for parsing and column detection, 7 service tests (duplicates and re-imports are skipped with a reason, one failing row never stops the rest, siblings share one parent), tried in a browser with a deliberately messy file, and on the live site with a duplicate row (nothing created, parents refused with 403). Players come in with neutral ratings (5 of 10) and the position from the file, or midfield. Not built yet: importing fixtures, guessing the age group from a date-of-birth column, and the magic-link invites (they need email).

## BL-0020 — Phone navigation bar along the bottom
- **Date:** 2026-10-02
- **Source task:** C1 (app shell); owner: "See the bar at the bottom I want something similar in mobile view" (with Spond and Teamo screenshots)
- **Idea:** On phones (720px and narrower) the row of tabs at the top is replaced by a bar along the bottom with icons, labels and badges: four main sections chosen by role plus More, which slides up a sheet with every other section and Sign out. Managers: Calendar, Chats, Lineup, Squad. Players: Calendar, Chats, Matches, Training. Parents: Children, Calendar, Chats, Membership. Desktop keeps the tab row (now with a Chats badge).
- **Rationale:** The tab row had ten-plus entries that scrolled sideways on a phone; the bottom bar is what players and parents know from Spond and Teamo.
- **Effort estimate:** S
- **Owning agent:** C (shell)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Built and committed. Verified in a browser at phone width for a manager, a player and a parent (badges, More sheet, choosing a section from More highlights More) and at desktop width (no bar, tab row shown). The lineup screen itself is unchanged.

## BL-0019 — Event chat: a group chat on every match and training session
- **Date:** 2026-10-02
- **Source task:** D6 (share-lineup UI); owner: "Each event should have a chat and I can share it in there that way it stays in the app" (replacing an open WhatsApp link, which was built on a branch and dropped before merging because of children's names)
- **Idea:** Every match and training session has a group chat for the team's players, their parents and the managers. A Chats tab lists them (unread first) and the Calendar has a Chat button with an unread count on every event. Managers post the saved lineup into the match chat from the Share dialog, with an optional message; it shows as a card (pitch, bench, and folded-away substitutions and minutes). Messages are labelled Manager / Player / Parent of …; managers can remove any message, everyone their own.
- **Rationale:** Keeps team chat, and children's names, inside the club's own app instead of WhatsApp.
- **Effort estimate:** M
- **Owning agent:** A/B (migration 011, chat service and routes), C/D (Chats, Calendar, Share dialog)
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Built and committed. No private one-to-one messages: everyone who can see the team's schedule sees every message, the usual safeguarding expectation where children are involved. Parents can now also read their child's team fixtures and training list (needed to reach the chats). Lineup cards are snapshots with names and shirt numbers only, never ratings. Open chats refresh every 8 seconds and unread counts every 30. 4 new API tests, verified end to end in a browser (coach posts a lineup, a player sees the badge, reads it and replies, a parent joins from the Calendar, the coach sees 2 unread). Also fixed two API tests that already failed on main (they assumed U12 had 11 players after an earlier test adds a 12th). Not built yet: phone notifications for new messages (needs push), photos in chat, and the coach muting or closing a chat.

## BL-0018 — Flexible substitutions with drag and drop (rebuild of BL-0017, owner priority: top)
- **Date:** 2026-10-02
- **Source task:** D4 (bench and planned substitutions); owner: "implement flexible substitutions with drag and drop so this is super easy, currently it doesn't really work, review yourself"
- **Idea:** Replace the list-of-changes editor with a rotation chart. One row per player, one column per 5-minute block, each cell showing the position that player holds then (or blank on the bench) and a total of minutes at the end of the row. Change anything by dragging one player's cell onto another player's cell, or by tapping a cell and tapping who to swap with. The chart can never become inconsistent, so nothing is greyed out or refused for confusing reasons.
- **Rationale:** Owner feedback. Review of BL-0017 on the real screen found:
  1. The Minute and Position menus are squashed to unreadable slivers in the side column, with the labels overlapping. The main controls could not be read. I only tested the DOM, never looked at the screen.
  2. Almost every choice is greyed out (about 15 of 39 minutes, and 1 position and 1 player per change), so the editor is mostly locked. "Flexible" fails.
  3. Changes depend on each other (a player can't come on before they have gone off), so one edit often has to be refused, and the refusal message does not say what to do.
  4. 16 rows of three menus is about 1,800 px tall, so you cannot see the whole rotation at once, which is how coaches think about it.
  5. The drag handles are tiny, the targets are menus, and what a drop will do is not obvious.
- **Effort estimate:** L
- **Owning agent:** D (plan card), shared engine (rotation maths)
- **Status:** Approved — owner commissioned this directly; this is the top priority.
- **Outcome (2026-10-02):** Done, committed in 62c0d85 and live.
  - **How it works:** a rotation chart with a row per player and a column per 5 minutes; each cell shows the position held then, blank on the bench, with a minutes total per row. Tap a cell and tap who to swap with (choosing "the rest of this stint" or "until a minute"), or drag one player's cell onto another's to swap them from that block. Dragging a player on the pitch onto one on the bench is a substitution; two players on the pitch, or two on the bench, are refused with a plain explanation, as is the starting lineup (change that on the pitch). Total minutes always equal positions times match length.
  - **Why it can't break:** every cell holds one position and every position always has one player, so the chart is always consistent. The list of changes is derived from it, and a swap that cannot be written as ordinary substitutions is refused instead of silently dropped.
  - **Also fixed during the review:** suggested 11-a-side plans used 7.5-minute steps (8, 23, 38...), which made the chart 60 columns wide, so suggested plans now snap to 5-minute marks (minutes are recalculated from the snapped plan). The top tab bar made the whole page scroll sideways on a phone with nine or ten tabs; it now scrolls inside itself.
  - **Tested:** 23 new engine tests (91 in all), a mouse drag, a tap, a touch press-and-hold drag and a plain swipe (must not drag) in a browser at desktop and phone widths, the long 11-a-side chart, and the live site on a phone-sized screen. Touch was tested with emulated touch events, not on a physical phone.
  - **Touch:** on touch a drag starts after holding a cell for about a quarter of a second, so an ordinary swipe still scrolls the page.
  - **Not built yet:** a position swap between two players who stay on the pitch (not a substitution, so done on the pitch), dragging across several blocks to pick a range, and the same editing on the Matchday screen.

## BL-0017 — Editable substitution plan: quick select and drag and drop
- **Date:** 2026-10-02
- **Source task:** D4 (bench and planned substitutions); owner request with a screenshot of the plan
- **Idea:** Each change in the Substitution plan card can be edited with menus (minute, position, player coming on), or by dragging: a player chip onto a change to bring them on, a change by its handle onto another to swap times, one change's player onto another's to swap them. Changes can be added and removed, the planned minutes update as you go, and "Reset to suggested plan" goes back. Saving the lineup saves the edited plan.
- **Rationale:** Owner: "I want to be able to change the substitution plan use dragging and dropping and quick select."
- **Effort estimate:** M
- **Owning agent:** D (plan card), shared engine (plan consistency maths)
- **Status:** Superseded by BL-0018 (the owner found it did not work in practice; see the review there).
- **Outcome (2026-10-02):** Done, committed in 410a0b4 and live, then replaced. The pitch itself is untouched (only the side card changed). Changes depend on each other (a player can't come on before they have gone off), so the plan is replayed after every edit: menu choices that would break a later change are greyed out, a drag that would break one is refused with a message, and removing a change also removes later ones that relied on it, with a message saying so. The chip strip stays in view while scrolling, and dragging near the screen edge scrolls the page. 8 engine tests; every drag and menu path tried in a browser with a mouse, but not yet on a real touch screen. Edits last until the lineup is re-planned (moving players on the pitch, changing availability or pressing Suggest lineup).

## BL-0016 — Season stats: attendance, availability and minutes
- **Date:** 2026-10-02
- **Source task:** Phase 2 (attendance tracking across matches and training)
- **Idea:** A Stats tab where a manager sees, per player, training sessions attended out of the past sessions where attendance was recorded, matches they said they were available for out of those already played, and minutes played from finished live matches. Sortable; minutes shown as a bar so uneven playing time stands out.
- **Rationale:** Master plan Phase 2, and it makes the fair-playing-time idea visible across the season.
- **Effort estimate:** M
- **Owning agent:** A/B (stats query, route), C (Stats screen)
- **Status:** Approved — owner commissioned this directly ("continue").
- **Outcome (2026-10-02):** Done, committed in 5f9da6a and live. Verified on the live site with throwaway past sessions: only past sessions with recorded attendance count, future and unrecorded ones don't, and parents get a 403. Not built yet: a player or parent seeing their own attendance, stats across a whole season boundary (there is no season concept yet), and stats across all of a manager's teams at once.

## BL-0015 — Pre-match briefings with read receipts
- **Date:** 2026-10-02
- **Source task:** Phase 3 (pre-match briefings: coaching material pushed to the squad, with "seen it" receipts)
- **Idea:** A manager attaches coaching notes and links (for example YouTube clips) to a match from the Fixtures screen. Players, and parents for their children, see it on the match card marked New, and press "Got it". The manager sees who has read it; editing the briefing resets everyone to unseen. Links must be http(s) only.
- **Rationale:** Master plan Phase 3.
- **Effort estimate:** M
- **Owning agent:** A/B (migration 010, briefing service, routes), C (briefing dialog, match card)
- **Status:** Approved — owner commissioned this directly ("continue").
- **Outcome (2026-10-02):** Done, committed in 4e584ab and live. 5 service tests, verified end to end on the live site (script links refused, parents can read and mark seen for their own child but not edit or see receipts, an edit resets the receipts). Not built yet: screenshots and file uploads (links only for now), a briefing tied to a formation rather than a match, and a push or email nudge when a briefing is posted.

## BL-0014 — Live matchday: clock, substitutions and minutes played
- **Date:** 2026-10-02
- **Source task:** Phase 3 (live matchday mode: real-time substitutions, automatic minutes-on-pitch tracking)
- **Idea:** A Matchday tab where a manager starts the match clock, pauses and resumes it, makes substitutions (planned ones are offered when due, or any manual swap), and finishes the match. Finishing adds each player's minutes to their season total, once, which feeds the fair-playing-time suggestions.
- **Rationale:** Master plan Phase 3. The clock and changes are stored on the server, so a phone dying or a second device doesn't lose the match.
- **Effort estimate:** L
- **Owning agent:** A/B (migration 009, live service, routes), C (Matchday screen), shared engine (minutes maths)
- **Status:** Approved — owner commissioned this directly ("please continue").
- **Outcome (2026-10-02):** Done, committed in 20e273b and live. 7 service tests, 9 engine tests, and a live end-to-end run (start refused without a lineup, change recorded, repeat refused, pause, finish, no changes after). Built as lists, not on the pitch diagram, because the pitch screen is frozen. Not built yet: players or parents watching a match live, goals and score, and period (quarter) markers on the clock.

## BL-0013 — Parent layer: link parents to players, answer for their children
- **Date:** 2026-10-02
- **Source task:** Phase 3 (parent/guardian layer)
- **Idea:** A manager links a parent to a player from the Squad screen (an existing parent is found by email; a new one is created with a first password). Parents get a "My children" tab to answer match availability and training RSVPs for each child.
- **Rationale:** Master plan Phase 3 — parents manage availability on behalf of a child.
- **Effort estimate:** M
- **Owning agent:** A/B (migration 008, routes, access), C (Family screen, Squad dialog)
- **Status:** Approved — owner commissioned this directly ("keep going").
- **Outcome (2026-10-02):** Done, committed in 25d10f2 and f2f8011, live. Verified against the live site: the U12 Boys parent sees their child, answers for them (200) and is refused for another family's child (403). Not built yet: parents seeing pickup times and payments for a child, and a parent following several teams' lineups.

## BL-0012 — Announcements and a ready email provider
- **Date:** 2026-10-02
- **Source task:** Phase 2 (announcements / messaging channel)
- **Idea:** Managers post to a squad in the app, and the backend can send email through Resend's web API once an account exists.
- **Rationale:** Master plan Phase 2; email can't go out from the VPS (hosting blocks the mail ports), so an HTTPS provider is the scalable route.
- **Effort estimate:** M
- **Owning agent:** B/C
- **Status:** Approved — owner commissioned this directly.
- **Outcome (2026-10-02):** Announcements done and live (5dc93b4). The Resend mailer is built and unit-tested with a fake provider but not switched on or tried against real Resend; it needs an account, DNS records and two settings (see deploy.md). Announcements are not yet emailed out.

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
