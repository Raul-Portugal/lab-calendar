# LabCal

Lab calendar PWA for wet-lab researchers (protocol scheduling, quotas, optional Supabase sync).
Vanilla JavaScript ES modules, no build step, no dependencies. Deployed by GitHub Pages from
the root of `main`: https://raul-portugal.github.io/lab-calendar/

The owner is a biomedical researcher, not a professional developer: explain changes in plain
language, and describe what to check in the app afterwards.

## Run and test

- Dev server: `python server.py --no-browser` → http://127.0.0.1:8000 (or the `labcal` entry in
  `.claude/launch.json`).
- Tests: open http://127.0.0.1:8000/test.html, wait ~3 s, read `#summary`
  ("All Tests Completed: N passed, 0 failed"). Run them before every commit; add tests for new
  logic to `test.html`.
- Check UI changes in the browser at desktop width **and** phone width (375 px), and with touch
  (dispatch `PointerEvent`s with `pointerType: 'touch'`).
- The service worker caches files in the browser: if a change doesn't show, unregister it or
  hard-reload (Ctrl+Shift+R).

## Rules that are easy to break

- **Escape user text**: anything put into `innerHTML` goes through `escapeHtml()`, colors through
  `safeColor()` (`js/utils.js`). Imported protocol files go through `sanitizeProtocol()`.
- **Times**: events may cross midnight. Use the absolute-minute helpers in `js/utils.js`
  (`toAbsMinutes`, `getEventSpan`, `spanToFields`, `getEventDayRange`, `isAllDayEvent`), never
  same-day `startTime`/`endTime` arithmetic.
- **State**: change data only through `store` methods in `js/state.js` (they record undo and call
  `notify(type)`). View-only notify types don't persist; `isLocalDataChange()` decides what syncs.
- **Protocol step fields** (`anchorType`, `gapMinutes`, `offsetMinutes`, `notBefore`, ...): a new
  field must be added to `sanitizeProtocol()`, the Protocol Builder, the tests, and
  `docs/protocol-import-llm-instructions.md` (+ its example JSON).
- **Sync** (`js/sync.js`): always pull before push; pushes are conditional on `updated_at`.
  Never overwrite the cloud or local data silently.
- **test.html**: never write a literal `</script>` inside it (ends the inline script; use
  `<\/script>`). Tests run on an isolated storage key; never touch `lab_calendar_data_v2`.
- **New static file** (CSS/JS/icon): add it to `STATIC_ASSETS` in `sw.js` and bump `CACHE_NAME`.

## Git workflow

- One branch per task, created from an up-to-date `main`; small commits with clear messages.
- **Ask before every `git push`.** After pushing, give the owner the
  `https://github.com/Raul-Portugal/lab-calendar/pull/new/<branch>` link and a PR description to
  paste (if the `gh` CLI isn't available). The owner reviews and merges; Pages deploys `main`
  automatically.
- Don't change the repo's git identity (user.name / user.email).
- Machine-specific notes (shell quirks, how pushing works on a given PC) belong in
  `CLAUDE.local.md`, which is not committed.

## Keeping the docs current

Part of every change, in the same branch, not a later task:

- **README.md**: update the feature list / shortcuts table when a user-facing feature is added,
  changed or removed.
- **docs/ROADMAP.md**: move finished items to "Done" (with the PR number once known); add newly
  discovered limits or ideas instead of only mentioning them in chat.
- **docs/protocol-import-llm-instructions.md** + example JSON: whenever the protocol file format
  or its validation (`sanitizeProtocol`) changes. The example must still import unchanged.
- **CLAUDE.md**: add a rule only when a mistake would otherwise be likely (a new invariant,
  command or gotcha); remove rules that no longer apply. Keep it under ~100 lines; put
  step-by-step procedures in `.claude/skills/` instead.
- **test.html**: new logic gets tests; changed behaviour updates the old tests.

## More

- Planned improvements and ideas: `docs/ROADMAP.md`.
- Protocol file format for LLM-generated protocols: `docs/protocol-import-llm-instructions.md`.
- Procedures: `/verify` (tests + browser checks), `/ship` (commit, ask, push, PR link).
