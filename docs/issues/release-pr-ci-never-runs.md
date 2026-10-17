# CI never ran on release-please's PRs

Status: fixed in `373cbcc` (2026-10-15), closed 2026-10-17.

Every release PR from 0.2.0 to 0.6.0 shows a failed or `action_required` `ci` run with zero jobs. Run 38736388703 (PR #7, head `0bfdb14`, 2026-10-15) has `actor` and `triggering_actor` `github-actions[bot]`, `jobs.total_count` 0, and GitHub's note "This run likely failed because of a workflow file issue". The same workflow passes on pushes to main and on PR #6, so the file is fine.

The cause is the token. `.github/workflows/release.yml` runs `googleapis/release-please-action` with the default `GITHUB_TOKEN`, and GitHub starts no workflow for events that token creates, except `workflow_dispatch` and `repository_dispatch`.

Fix: `ci.yml` accepts `workflow_dispatch`, and `release.yml`'s `ci-on-release-pr` job dispatches it on the release PR's branch whenever release-please creates or updates the PR. The dispatched run tests the PR's head commit, so its checks show on the PR. The empty `pull_request` run still appears beside it and can be ignored. The merge gate is the dispatched `ci` run's success on the PR head SHA.

A PAT or GitHub App token for release-please would remove the empty run as well; that needs BK to create a credential and isn't required.

## Closed: the dispatched run shows on the release PR

The fix is in place on `origin/main` at `306a0e5`: `.github/workflows/ci.yml:8` accepts `workflow_dispatch`, and the `ci-on-release-pr` job at `.github/workflows/release.yml:32` runs `gh workflow run ci.yml --ref <release branch>` whenever release-please opens or updates its PR. `gh run list --workflow ci.yml --event workflow_dispatch` shows the six most recent runs, all successful, on `release-please--branches--main--components--keyloom`, from 2026-10-16T23:21Z to 2026-10-17T00:01Z, the latest on head `b6eef09` (run 38984422642). The empty `pull_request` run still appears beside them, as the fix section says.

What would remove it: a PAT or GitHub App token for release-please. Not needed, so not tracked.
