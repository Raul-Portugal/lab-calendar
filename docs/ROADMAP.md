# LabCal roadmap

Ideas and planned improvements, roughly in suggested order. Effort: S < ½ day, M ≈ 1–2 days,
L = several days. Move items to "Done" (with the PR number) when they are merged.

## Next up

### Small fixes / known limits
- Earliest-start rule (`notBefore`) is applied only when a protocol is placed; re-apply it when
  steps are shifted or cascaded. (S)
- Working hours and earliest start ignore weekends; optional "skip weekends" for protocol steps. (M)
- "Clear sample data" button: removes the demo recurring events (Lab Meeting, Department
  Seminar) and the sample thesis-writing block created on first launch. (S)

### User experience (quick wins)
- Replace browser `alert` / `confirm` / `prompt` with in-app dialogs; "Deleted. Undo" toasts
  instead of "Are you sure?". (M)
- Escape closes any dialog, focus stays inside open dialogs, Enter saves. (S)
- Accessibility: ARIA labels on icon buttons, keyboard navigation, visible focus. (M)
- "Update available, reload" toast when a new version is deployed; show the app version and
  last-sync time in the Cloud Sync dialog. (S)
- Empty states and first-run tips. (S)

### Visual design
- Dark mode (system setting + manual switch). (M)
- One consistent SVG icon set instead of mixed emoji. (S)
- Shared design tokens (colors, spacing, radii) across the CSS files; WCAG AA contrast. (M)
- Clearer chained-protocol visuals: connector between steps of a run, run progress. (M)

## Later

### Lab features
- Step reminders (notifications before a step starts / an incubation ends). (M, L with push)
- Protocol run tracking: tick off steps, per-run notes, export a run sheet for the lab notebook. (M)
- Reagent lists per protocol, scaled by sample number. (M)
- More recurrence rules: daily, every N weeks, monthly, end after N times. (M)
- Import .ics; later a subscribable calendar feed (would make Google Calendar stay in sync,
  including deletions, which .ics import can't do). (M / L)
- Quota history charts; search results list across weeks. (S–M)

### Backend and sync
- Per-item merge sync (each item has `updatedAt`, deletions recorded) so edits on two devices
  merge without the conflict dialog. Prerequisite for multi-user features. (L)
- Live updates via Supabase Realtime. (M)
- Don't keep the encryption passphrase in plain localStorage (non-extractable key in IndexedDB). (M)
- Move local storage from localStorage (~5 MB cap) to IndexedDB; automatic local backups. (M)
- Decision needed: multi-user lab features (shared protocol library, shared lab calendar,
  equipment booking with conflict detection). Needs a multi-user Supabase schema. (L)

### Code health
- GitHub Actions: run `test.html` in headless Chromium (Playwright) on every PR. (S)
- Split `js/app.js` into per-dialog modules; move inline styles from JS into CSS. (M)
- ESLint + Prettier. (S)
- Cheaper rendering (CSS grid lines instead of 672 quarter-hour divs per week). (M)

## Done
- #1 Review fixes: test-suite data loss, XSS hardening, conflict-safe sync, broken features, touch + phone layout.
- #2 Overnight events, narrow-screen alignment + 3-day view + swipe, protocol builder (add at bottom, drag reorder, preview times).
- #3 Protocol import button, protocol categories, LLM protocol instructions, service-worker update fix.
- #4 Foldable sidebar, working-hours shading, hide passive steps, overlapping steps + earliest start, .ics export dialog.
