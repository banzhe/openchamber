# Conflict Resolution Loop

Load this reference whenever staged rebase stops, reports an empty or dropped
patch, or exposes an automatic conflict resolution. Resolve repository intent,
not side labels.

## 1. Inventory The Stop

- Record `REBASE_HEAD` and its subject when present, the rebase output, and
  whether the sequencer stopped on a `pick` or a rebuilt `merge`.
- Read `git status --porcelain=v2` and
  `git diff --name-only --diff-filter=U`.
- Read `git ls-files -u` to capture every staged mode and object ID, including
  binary, symlink, submodule, rename, and directory/file conflicts that have no
  text marker.
- Keep a conflict ledger with replayed commit, file, competing intents, chosen
  resolution, and expected patch difference.

Complete when every unmerged path and every exceptional event at this rebase
stop has one ledger entry.

## 2. Reconstruct Intent

For every unmerged path:

- On a `pick` stop, stage 2 (`ours`) is the new base plus already replayed
  commits, and stage 3 (`theirs`) is the commit being replayed.
- On a rebuilt `merge` stop, inspect the sequencer's completed/current commands
  to identify the original merge, all original parents, and all rebuilt parents.
  Stage 2 and stage 3 are temporary merge heads, not aliases for one original
  commit. Compare parent topology and each parent-to-merge tree change before
  resolving.
- Load every repository skill triggered by the conflicted subsystem, then read
  its nearest `DOCUMENTATION.md`, package `README.md`, local tests, and callers.
- Inspect the combined conflict with `git diff --cc -- <path>`.
- Inspect stage 1-to-2 and stage 1-to-3 changes with
  `git diff :1:<path> :2:<path>` and `git diff :1:<path> :3:<path>`. Apply the
  pick or rebuilt-merge meanings defined above. For an add/delete conflict,
  inspect each stage that exists with `git show`.
- On a `pick`, inspect `git show REBASE_HEAD -- <path>` so the replayed commit's
  full purpose remains visible beyond the marker hunk. On a rebuilt merge,
  inspect the original merge and every parent instead.
- Classify each overlap:
  - Independent additions: preserve both and integrate their call sites/types.
  - Same invariant, different implementation: select the implementation that
    satisfies current docs, tests, and callers while retaining the replayed
    behavior.
  - Superseded replay change: retain the new-base contract and document why the
    old patch is no longer applicable.
  - Mutually exclusive product intent: exhaust repository evidence, then ask the
    user only if no authoritative contract can decide it.

Completion requires an explicit resolution for every marker and every
non-text, add/delete, mode, or rename decision, with the relevant base and parent
intents accounted for.

## 3. Resolve And Advance

- Make the smallest semantic edit. A whole-file side is acceptable only after
  full inspection proves it exactly implements both required intents.
- Re-read each resolved file around the edit and inspect its diff.
- Run `git diff --check`; search resolved files for conflict markers.
- Stage only reviewed conflict paths. Verify
  `git diff --name-only --diff-filter=U` is empty for this stop.
- Continue without an editor using
  `git -c rerere.enabled=false -c rerere.autoupdate=false -c core.editor=true rebase --continue`.
- Repeat this loop for every later stop; append rather than replace ledger
  entries.

For an empty or dropped patch:

- Compare the original commit diff with the staged tree and preceding rebuilt
  commits.
- Use `git rebase --skip` only when the ledger proves every intended tree change
  is already present or intentionally superseded by an authoritative contract.
- Preserve a deliberately empty commit only when repository history or policy
  makes that empty identity meaningful; record how it was recreated.

Complete when rebase finishes, no unmerged path or conflict marker remains, and
the ledger records the expected effect of every conflict, automatic resolution,
empty patch, and dropped patch for later `range-diff` proof.
