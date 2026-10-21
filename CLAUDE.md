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

## Windows shell quirks (this machine)

- Git may not be on PATH in a fresh PowerShell: run
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')` first.
- Multi-line commit messages: write the message to a file in the scratchpad and use
  `git commit -F <file>` (PowerShell here-strings get mangled).
- Don't rewrite files with `Set-Content` / `Out-File` (they add a BOM or change encoding);
  use the Edit/Write tools, or .NET `WriteAllText` with UTF-8 without BOM.

## Git workflow

- One branch per task, created from an up-to-date `main`; small commits with clear messages.
- **Ask before every `git push`.** Pushing works non-interactively with `$env:GCM_INTERACTIVE='never'`
  (credentials are stored). There is no `gh` CLI: after pushing, give the owner the
  `https://github.com/Raul-Portugal/lab-calendar/pull/new/<branch>` link and a PR description to
  paste. The owner reviews and merges; Pages deploys `main` automatically.
- Repo git identity is set locally (GitHub noreply email); don't change it.

## More

- Planned improvements and ideas: `docs/ROADMAP.md` (update it when an item is done).
- Protocol file format for LLM-generated protocols: `docs/protocol-import-llm-instructions.md`.
