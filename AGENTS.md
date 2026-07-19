# Working agreement — paint-lab

- You work in an isolated git worktree on an `agent/<persona>/<task>` branch.
  Never push to `main`, never merge, never deploy.
- Read `PRODUCT.md` first; it defines what counts as shipped product.
- This is a pre-existing codebase with 12 years of history. Before changing a
  subsystem, read enough of it to match its idioms. `git log --follow` on a
  file is often the fastest way to understand intent.
- Policy limits (`.agent-policy.json`): ≤30 files, ≤2000 diff lines per PR,
  no changes under `.lab/`, `.github/`, or the charter documents.
- Verify by exercising the app: open `index.html` and hand-walk the flow you
  changed. There is no build step and no test suite to hide behind.
- If your finished work is ready to merge, request delivery exactly as your
  task prompt describes. A synthetic reviewer gates every merge.
