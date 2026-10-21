---
name: ship
description: Commit the current work on a branch, push it after asking, and give the owner the pull-request link and description.
disable-model-invocation: true
---

# Ship a change

1. Check `git status` and `git branch --show-current` (machine-specific git notes are in
   CLAUDE.local.md). If on `main`, create a branch named after the task:
   `git checkout -b <short-task-name>`.
2. Run the `verify` skill; don't continue with failing tests.
3. Docs check (see "Keeping the docs current" in CLAUDE.md): README for user-facing changes,
   docs/ROADMAP.md for finished items or new limits, the LLM protocol instructions if the
   protocol format changed, CLAUDE.md if a new rule is needed. Update them in this branch.
4. Review `git diff` (no personal data, keys or machine paths in committed files), then commit
   with a clear message, ending with the attribution line from the current instructions.
5. Ask the owner: "May I push `<branch>` to GitHub?" and wait for a yes.
6. Push (see CLAUDE.local.md for how pushing works on this PC): `git push -u origin <branch>`.
7. Give the owner:
   - the link `https://github.com/Raul-Portugal/lab-calendar/pull/new/<branch>`
   - a short PR description in a code block (what changed, tests passing, what wasn't tested)
   - what to check in the app after merging (GitHub Pages updates `main` in 1–2 minutes)
