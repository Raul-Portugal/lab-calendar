---
name: verify
description: Run the LabCal test suite and check the app in the browser (desktop + phone width). Use after changing code, before committing.
---

# Verify LabCal

1. Start the dev server with the `labcal` entry in `.claude/launch.json` (preview_start), or reuse
   it if it is already running.
2. Open `http://localhost:8000/test.html?r=<random>` in the browser pane. If an old version
   loads, unregister the service worker first
   (`navigator.serviceWorker.getRegistrations()` → `unregister()`, then delete `caches`).
3. After ~3 s read `#summary` and every `.fail` row. Report the exact count
   ("All Tests Completed: N passed, 0 failed"). Fix failures before going on.
4. Open `http://localhost:8000/index.html` and check the changed feature:
   - no errors in the console (read_console_messages, onlyErrors)
   - desktop width, then phone width (resize_window preset `mobile`), then back to `desktop`
   - for drag / long-press features, dispatch `PointerEvent`s with `pointerType: 'mouse'` and `'touch'`
5. If the check adds test data, save `localStorage['lab_calendar_data_v2']` first and restore it
   afterwards.
6. Summarize what was verified and what wasn't (e.g. real phone, real Supabase).
