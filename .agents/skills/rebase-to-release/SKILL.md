---
name: rebase-to-release
description: Rebase a topic branch to an exact release and build its Windows Electron installer.
argument-hint: "[version|latest] [remote]"
disable-model-invocation: true
---

# Rebase To Release

Treat the rewrite as a transaction: keep the original branch immutable, prove a
staged rewrite, then publish it with compare-and-swap. The release authority is
the selected remote's `main` first-parent history.

## Parse Input

- Omitted or `latest` selects latest mode.
- An explicit selector accepts `1.16.3` or `v1.16.3`, preserves a SemVer
  prerelease suffix, and normalizes to canonical `v1.16.3[-prerelease]`.
- Parse positional arguments exactly:
  - No arguments: latest mode with inferred remote.
  - One `latest` or SemVer argument: that selector with inferred remote.
  - One argument exactly matching a configured remote: latest mode on it.
  - Two arguments: selector first, configured remote second.
  - Otherwise ask the user to clarify.
- A supplied remote must exactly match a configured remote. Without one, use the
  only configured remote; ask the user when there are zero or multiple remotes.

Complete when the mode, canonical explicit version if any, and one configured
remote are recorded.

## Transaction

1. Establish the safe snapshot.
   - Read repository Git and validation instructions plus
     `packages/electron/README.md`.
   - Inspect branch, full HEAD, remotes, `git status --porcelain=v2 --branch
     --untracked-files=all`, `git worktree list --porcelain`, Git operation
     markers, Git lock files, and active Git processes.
   - Announce an exclusive rewrite window and run no parallel agent that can use
     Git during the transaction. Read-only polling such as `status`, `rev-parse`,
     `remote -v`, and `config --get` is harmless; a ref/worktree writer or a
     persistent process whose intent cannot be identified blocks the rewrite.
   - Require native Windows, Bun, installed workspace dependencies, and the
     Electron packaging prerequisites documented by the repository. Packaging
     must be able to produce a native Windows NSIS installer.
   - A safe snapshot is a named topic branch other than `main`, a clean tracked
     and untracked worktree, and no merge, rebase, cherry-pick, revert, or bisect.
     Existing work remains untouched rather than stashed, committed, or removed.
   - Record the original branch and full original HEAD.

   Complete when the original ref and worktree are stable, recorded, clean, and
   exclusively controlled, and native Windows packaging prerequisites pass.

2. Select one authoritative release.
   - Fetch only the selected remote's `main` tracking ref:
     `git fetch <remote> +refs/heads/main:refs/remotes/<remote>/main`.
   - Inspect `git log --first-parent --format=%H%x09%s <remote>/main`.
   - In latest mode, walk newest to oldest and choose the first subject exactly
     matching `release v<SemVer>`. History order is authority; version sorting,
     tags, and non-first-parent commits are outside this selection.
   - For an explicit selector, match the exact subject
     `release <canonical-version>`. Multiple matches require the user to select
     one of the displayed full SHAs.
   - When no exact match exists, report nearby first-parent `release v...`
     subjects and stop.
   - Verify and record canonical version, exact subject, and full release SHA.

   Complete when exactly one verified first-parent release commit is recorded.

3. Freeze the replay contract.
   - Run `git merge-base --all <original-head> <remote>/main`; require exactly
     one fork.
   - List every commit in `<fork>..<original-head>` in replay order with full
     SHA, parents, and subject. Record the count and every merge commit.
   - Classify the release relative to the fork:
     - Equal: release equals fork; the original HEAD is already the staged HEAD.
     - Forward: fork is an ancestor of release.
     - Downgrade: release is an ancestor of fork; obtain explicit confirmation.
     - Incomparable: stop without rewriting.
   - A replay range containing merges uses `--rebase-merges`; a linear range
     uses ordinary rebase.

   Complete when one fork, the exhaustive replay list, target direction, and
   merge strategy are recorded before any topic ref moves.

4. Stage the transaction.
   - Equal is a no-op: keep the original branch checked out and create no
     temporary refs.
   - Otherwise create a unique backup ref under
     `refs/rebase-to-release/backups/` with old value zero, point it at the
     original HEAD, and verify it. Create a unique branch under
     `rebase-to-release/` at the original HEAD, switch to it, and verify the
     original branch still resolves to the original HEAD.
   - For a non-empty replay range run with rerere disabled for this operation:
     `git -c rerere.enabled=false -c rerere.autoupdate=false rebase --no-autostash --no-update-refs [--rebase-merges] --onto <release-sha> <fork-sha>`.
   - For an empty forward range run `git merge --ff-only <release-sha>`.
   - For an empty confirmed downgrade run `git reset --hard <release-sha>` only
     on the clean temporary branch and verify its HEAD.
   - Capture all rebase output. When rebase stops, reports an empty or dropped
     patch, or exposes any automatic conflict resolution, immediately load and
     execute [`CONFLICTS.md`](CONFLICTS.md). Resolve every repository-decidable
     stop autonomously; reserve user input for a documented, irreducible product
     decision.
   - If staging cannot complete, execute **Rollback**.

   Complete when equal mode verifies the original branch remains at original
   HEAD with no safety refs; the temporary branch holds a finished staged
   rewrite with a ledger accounting for every exceptional rebase event; or
   **Rollback** has restored the original snapshot.

5. Prove the staged result.
   - Record staged HEAD. Verify the release SHA is its ancestor, the worktree is
     clean, and no Git operation remains.
   - Run
     `git range-diff --no-color <fork>..<original-head> <release-sha>..<staged-head>`.
     Map both directions: every original and staged non-merge commit has exactly
     one counterpart or one ledger explanation. Explain every missing, added, or
     materially changed patch; `range-diff` output alone is not proof.
   - `range-diff` omits merges. Map original and rebuilt merges one-to-one in both
     directions; verify count, parent topology, and merge-introduced tree change.
     A missing, added, or ambiguous merge fails proof.
   - Synchronize the staged dependency tree with
     `bun install --frozen-lockfile`. A tracked change or lock mismatch fails
     proof.
   - Derive and record a validation manifest from the replayed files, conflict
     ledger, loaded repository skills, and package scripts. Use the
     `workflow-runner` subagent to run every listed test, type-check, lint, and
     affected non-packaging build without Git commands; record every exit code.
   - Before packaging, derive the expected filename from the staged Electron
     package version and native architecture. Record build-affecting target,
     OpenCode CLI override, and signing environment presence without recording
     secret values. Snapshot the exact installer and
     `dist/win-unpacked/OpenChamber.exe`, if present, with size, UTC modification
     time, and SHA-256; record build start time.
   - Normalize `OPENCHAMBER_TARGET_ARCH` and `ELECTRON_BUILDER_ARCH`; each must be
     unset or equal the native architecture, and they must agree. Require
     `OPENCHAMBER_OPENCODE_CLI_VERSION` to be unset or exactly equal the staged
     root `@opencode-ai/sdk` version. Any mismatch stops before packaging.
   - Use a `workflow-runner` subagent from the repository root to run
     `bun run electron:build`. Require exit code zero and a newly created or
     updated non-empty
     `packages/electron/dist/OpenChamber-<version>-win-<arch>.exe`.
   - Prove both files were created or updated by this run, then record artifact
     path, size, UTC modification time, SHA-256, target architecture, and signed
     or unsigned status. Require builder output to associate the same-run
     `win-unpacked` directory, architecture, and exact NSIS filename. Verify the
     payload PE machine type from `dist/win-unpacked/OpenChamber.exe`; the NSIS
     launcher stub itself may be x86 for an x64 payload.
   - Determine expected signing before the build from signing-variable presence,
     without reading values. An explicitly unsigned build requires the package
     script's unsigned message and installer Authenticode `NotSigned`; a signing
     build requires installer Authenticode `Valid` and records its result.
   - Recheck clean status and all Git operation markers after validation.
   - On proof failure, preserve evidence and execute **Rollback** when safety
     refs exist. An equal no-op instead verifies the original branch still equals
     original HEAD and leaves it unchanged.

   Complete when every patch and merge is accounted for, all required validation
   and native Windows packaging pass, the exact installer is independently
   verified, and the staged worktree remains clean with no Git operation.

6. Publish the transaction.
   - Equal no-op skips ref movement and verifies the original branch is still at
     original HEAD.
   - Otherwise recheck `git worktree list --porcelain`, active Git writers, lock
     files, original ref, staged ref, and backup ref. The original branch must be
     held by no worktree before CAS; the temporary branch must be held only by the
     current worktree. Any possible ref/worktree writer blocks publication.
   - Compare-and-swap the original branch:
     `git update-ref refs/heads/<original-branch> <staged-head> <original-head>`.
     Verify the ref, switch to the original branch, and verify HEAD equals staged
     HEAD.
   - Delete the temporary branch and backup ref together in one
     `git update-ref --stdin` transaction with their expected old SHAs. If CAS,
     switching, verification, or cleanup fails, retain every remaining safety
     ref and report original, staged, temporary, and backup identities.
   - Verify final clean status, no Git operation, the original branch held only
     by the current worktree, the temporary branch held by none, and no refs under
     `refs/rebase-to-release/` or `refs/heads/rebase-to-release/`.
   - Recompute the installer SHA-256 and require it to equal the proven post-build
     hash.
   - Report branch, remote, release subject/SHA, original/new HEAD, replay count,
     patch and merge proof, conflict resolutions, validation, installer details,
     and upstream divergence.

   Complete when the original branch points to the proven staged HEAD, every
   safety ref is gone, the worktree is clean, no Git operation remains, and the
   verified installer still exists.

## Rollback

Use this single rollback sequence for every failure after temporary refs exist:

1. Abort only the active rebase or merge and verify no Git operation remains.
2. Require the original branch ref still equals original HEAD. A mismatch keeps
   every safety ref and stops for user direction; the rollback never overwrites
   an independently moved original branch.
3. Require a clean worktree, switch to the original branch, and verify HEAD.
   Unexpected changes remain untouched and block further cleanup.
4. Delete every safety ref that exists together with one `git update-ref --stdin`
   transaction using each expected old SHA.
5. Verify the original snapshot, clean status, no operation, and absence of both
   temporary refs.

Rollback completes only when the recorded original branch and HEAD are restored
without discarding work and both safety refs are absent. If any check fails,
retain all remaining evidence and report the exact refs and worktree state.

## Push Boundary

Leave all remotes unchanged after the selected `main` fetch. Report the rewritten
branch's upstream divergence; pushing is outside this skill.
