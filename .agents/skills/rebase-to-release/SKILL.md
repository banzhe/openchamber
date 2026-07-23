---
name: rebase-to-release
description: Rebase the current branch onto the latest or an exact remote main release, then build the Windows Electron installer.
argument-hint: "[version|latest] [remote]"
disable-model-invocation: true
---

# Rebase To Release

Rebase the current topic branch onto an exact release on a selected remote's
`main` first-parent history, then build the Windows Electron installer.

## Input

- The version selector is optional. Omitted or `latest` selects latest mode.
- For an explicit version, accept `1.16.3` or `v1.16.3` and normalize both to
  the canonical version `v1.16.3`. Reject non-semantic versions and preserve an
  explicit prerelease suffix such as `1.16.3-rc.1`.
- Parse positional input deterministically:
  - No arguments: latest mode with inferred remote.
  - One `latest` or semantic-version argument: that selector with inferred
    remote.
  - One argument exactly matching a configured remote: latest mode on that
    remote.
  - Two arguments: selector first, configured remote second.
  - Any invalid or ambiguous input: stop and ask the user to clarify.
- If a remote is supplied, require it to exactly match a configured remote and
  stop if it does not. If none is supplied, use the only configured remote; if
  there are zero or more than one, stop and ask the user to select or configure
  one.

Complete when latest or an explicit canonical version is recorded and the
configured remote is unambiguous.

## Procedure

1. Establish a safe starting point.
   - Read the repository instructions that govern Git and validation.
   - Inspect the current branch, remotes, worktree, and Git operation state.
   - Require a Windows host, Bun, installed workspace dependencies, and the
     Electron packaging prerequisites documented in `packages/electron/README.md`.
     Stop before rewriting history if a native Windows package cannot be built;
     do not substitute a cross-platform Electron build.
   - Establish an exclusive history-rewrite window for the full procedure. If
     another agent or process may change refs or worktree registrations, require
     it to pause before continuing; no Git command can make an uncoordinated
     multi-process rewrite safe.
   - Stop if HEAD is detached, the current branch is `main`, another Git
     operation is in progress, or tracked/untracked changes exist. Do not stash,
     discard, or commit existing work on the user's behalf.
   - Record the branch name and original HEAD SHA.

   Complete when the named topic branch is clean, no Git operation is active,
   its original HEAD is recorded, and exclusive ref/worktree control is
   established.

2. Resolve one authoritative release commit.
   - Update only the selected remote's `main` tracking ref:
     `git fetch <remote> +refs/heads/main:refs/remotes/<remote>/main`.
   - Inspect `git log --first-parent --format=%H%x09%s <remote>/main`.
   - In latest mode, walk that output from newest to oldest and select the first
     subject exactly matching `release v<SemVer>`. History order defines latest;
     do not sort versions, inspect tags, or select a non-first-parent commit.
   - For an explicit version, derive the target subject as
     `release <canonical-version>` and match it exactly. If duplicates exist,
     show their SHAs and require the user to select one.
   - If the selected mode finds no match, report nearby `release v...` subjects
     from the first-parent history and stop.
   - Record the canonical version, exact subject, and full release SHA.

   Complete when one first-parent release commit is identified and verified.

3. Define the replay range before rewriting history.
   - Compute all merge bases with
     `git merge-base --all <original-head> <remote>/main` and require exactly
     one fork point.
   - List and count every commit in `<fork>..<original-head>`.
   - Classify the target relationship: equal, forward (`fork` is an ancestor of
     release), downgrade (release is an ancestor of `fork`), or incomparable.
     An equal target needs no rewrite. A downgrade requires explicit
     confirmation. An incomparable target must stop.
   - Detect merge commits in the replay range. Preserve them with
     `--rebase-merges`; never flatten merge topology silently.

   Complete when the fork point, replay commits, target direction, and merge
   strategy are explicit.

4. Stage the rewrite without moving the original branch.
   - If the target equals the fork, treat the original HEAD as the staged HEAD;
     do not create temporary refs or rewrite commits.
   - Create a unique backup ref under `refs/rebase-to-release/backups/` at the
     original HEAD and verify it resolves to that SHA.
   - Create and switch to a unique temporary branch at the original HEAD. Use a
     valid name under `rebase-to-release/` and verify it does not already exist.
     Skip this and the remaining staging actions only for the equal no-op.
   - If the replay range is non-empty, run:
     `git rebase --no-autostash --no-update-refs [--rebase-merges] --onto <release-sha> <fork-sha>`.
   - If the replay range is empty and the target is forward, use
     `git merge --ff-only <release-sha>` on the temporary branch.
   - If the replay range is empty and a downgrade was confirmed, move only the
     clean temporary branch with `git reset --hard <release-sha>`, then verify
     its HEAD equals the release SHA. The original branch remains untouched
     until proof succeeds.
   - If a conflict occurs, inspect both sides of every conflicted file and
     resolve according to repository intent. Never choose `ours` or `theirs`
     wholesale without inspection. Stage resolved files and continue without
     opening an interactive editor.
   - If conflict intent cannot be established, ask the user. If the operation
     is cancelled or cannot be completed, run `git rebase --abort` only when a
     rebase is active. Then verify no Git operation remains, switch back to the
     original branch, verify its HEAD is still the recorded original SHA, and
     delete the temporary branch and backup ref.

   Complete only when the staged rewrite succeeds or the untouched original
   branch is restored with no temporary operation left behind.

5. Prove the result.
   - Verify the release SHA is an ancestor of the staged HEAD.
   - Verify the worktree is clean and no Git operation remains active.
   - Compare `<fork>..<original-head>` with `<release-sha>..<staged-head>` using
     `git range-diff`. Account for every missing or materially changed patch;
     expected conflict-resolution differences must be explained.
   - Because `range-diff` ignores merges, map every original merge to its
     rebuilt merge and verify the merge count, parent topology, and
     merge-introduced tree change. Ambiguous or missing mappings fail proof.
   - Run the repository-required validation for the affected surface,
     especially when conflicts changed code or the new base changes contracts.
   - Use the `workflow-runner` subagent to run `bun run electron:build` from the
     repository root. This is a required Windows packaging gate, not an optional
     follow-up.
   - Require a zero exit code and verify that this run created or updated the
     expected non-empty NSIS installer under `packages/electron/dist`:
     `OpenChamber-<electron-package-version>-win-<arch>.exe`. Record its path,
     size, architecture, and whether the build reported signed or unsigned.
   - After validation, verify again that the worktree is clean and no Git
     operation is active. Otherwise proof fails.
   - If proof fails and a temporary branch was created, switch back to the
     unchanged original branch and remove the temporary branch. Never discard
     unexpected worktree changes to perform this cleanup; stop and ask the user
     if any appear. Remove the backup ref only after confirming the original
     branch still points to the original HEAD. For an equal no-op, verify the
     original branch was unchanged.
   - After proof succeeds, record the staged HEAD. Unless this was an equal
     no-op, inspect `git worktree list --porcelain` and stop if another worktree
     has the original branch checked out. Do not publish while another Git
     process may be changing worktree registrations or refs. Then atomically
     move the original branch only if nobody changed it:
     `git update-ref refs/heads/<original-branch> <staged-head> <original-head>`.
     Verify the original branch ref now equals the staged HEAD. Then switch back
     to the original branch, verify HEAD, and delete the temporary branch and
     backup ref. If the compare-and-swap or any later publication action fails,
     keep both temporary refs, report the original, staged, and backup refs, and
     do not claim completion.
   - Report the branch, remote, release subject/SHA, original/new HEAD, replayed
     commit count, patch and merge comparison, conflicts, validation, and the
     Windows installer artifact.

   Complete when every original patch and merge is accounted for, validation
   and Windows Electron packaging pass, the installer is verified, the worktree
   is clean, no Git operation is active, the original branch points to the
   proven HEAD, and all temporary refs are gone.

## Push Boundary

Do not push as part of this skill.
