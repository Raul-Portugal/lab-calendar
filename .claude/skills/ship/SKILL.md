---
name: ship
description: Commit the current work on a branch, push it after asking, and give the owner the pull-request link and description.
disable-model-invocation: true
---

# Ship a change

1. Refresh PATH for git (see CLAUDE.md), then `git status` and `git branch --show-current`.
   If on `main`, create a branch named after the task: `git checkout -b <short-task-name>`.
2. Run the `verify` skill; don't continue with failing tests.
3. Review `git diff`, then commit with a clear message written to a scratchpad file
   (`git commit -F <file>`), ending with the attribution line from the current instructions.
4. Ask the owner: "May I push `<branch>` to GitHub?" and wait for a yes.
5. Push: `$env:GCM_INTERACTIVE='never'; git push -u origin <branch>`.
6. Give the owner:
   - the link `https://github.com/Raul-Portugal/lab-calendar/pull/new/<branch>`
   - a short PR description in a code block (what changed, tests passing, what wasn't tested)
   - what to check in the app after merging (GitHub Pages updates `main` in 1–2 minutes)
7. If an item from `docs/ROADMAP.md` is now done, move it to "Done" in the same branch.
