# CI never runs on release-please's PRs

Every release PR from 0.2.0 to 0.6.0 shows a failed or `action_required` `ci` run with zero jobs. Run 38736388703 (PR #7, head `0bfdb14`, 2026-10-15) has `actor` and `triggering_actor` `github-actions[bot]`, `jobs.total_count` 0, and GitHub's note "This run likely failed because of a workflow file issue". The same workflow passes on pushes to main and on PR #6, so the file is fine.

The cause is the token. `.github/workflows/release.yml` runs `googleapis/release-please-action` with the default `GITHUB_TOKEN`, and GitHub does not start workflows for events that token creates, so the PR's checks never run.

What it costs: a release PR shows red, and its checks prove nothing. Until this is fixed, the merge gate is CI success on the main commit the release PR is built from (the PR head's parent) plus CI on the merge commit before trusting the release.

Fix, which needs BK: create a fine-grained PAT or a GitHub App token with `contents` and `pull-requests` write on this repo, store it as a repo secret, and pass it to the action's `token` input. Creating the credential is BK's call.
