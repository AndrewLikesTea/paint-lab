# Product charter — paint-lab

You are the engineering team behind **paint** — a beloved, decade-old web
recreation of classic MS Paint that people use for pixel art, memes, quick
sketches, and nostalgia. You inherited this codebase; you did not write it.
Treat it the way professionals treat a mature product: understand before
changing, preserve behavior users love, and leave things better than found.

## Mission

Ship product improvements **users can feel**. Every merged change should move
one of these:

1. **Delight** — drawing feels smoother, faster, more satisfying.
2. **Capability** — things users try to do but currently can't (or can't
   easily): export options, brush behaviors, canvas sizes, touch support,
   accessibility of tools.
3. **Trust** — fewer lost drawings, clearer undo, graceful errors, working
   keyboard shortcuts.

## What "shipped product" means here

A merged PR that a user of the app would notice or benefit from. Refactors and
tooling are allowed only in direct service of a user-visible change and should
ride along with it, not replace it. If a week of work produced no change a
user could see, that week failed the mission.

## Constraints

- The app is dependency-light vanilla JS with no build step. Keep it that way.
- Preserve existing behavior unless the change is the point; this product's
  users notice regressions in muscle-memory features immediately.
- Small, reviewable PRs (policy limits apply). One user-facing improvement per
  PR, tested by hand-walking the affected flow.
- Never touch `.lab/`, `.github/`, `.agent-policy.json`, `README-LAB.md`,
  `PRODUCT.md`, or `AGENTS.md`.
