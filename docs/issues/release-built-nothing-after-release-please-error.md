# A release-please error after creating the release leaves it with no binaries

On 2026-10-22, merging release PR 162 ran `release.yml` (run 39805057406) on 766da2f. release-please created the v0.53.1 release and tag, labelled the PR `autorelease: tagged`, then failed while refreshing release PRs. GitHub's GraphQL API answered "Something went wrong while executing your query" (request `A049:257FCF:45877E8:E1CAB7F:6ADA2B82`). The job failed, so `build-native`, `build-binaries` and `build-desktop`, which need its `release_created` output, were skipped. v0.53.1 was published with no assets, and `install.sh` installs the latest release, so installs failed until it was built.

Re-running the job doesn't help. With the PR already tagged, release-please creates nothing and reports no release, so the builds skip again.

Fix: `release.yml` accepts a `workflow_dispatch` with a `tag` input. It skips release-please, refuses a release that already has assets, and runs the normal build jobs against that tag.

Status: fixed by PR 163. v0.53.1 was built through it by run 39807239192, dispatched from the reviewed PR head before the merge, and all ten assets were verified against `SHA256SUMS`. The workflow refuses any ref other than main; it can't defend against an edited copy of itself on another branch, which would need a protected environment for the publishing jobs.
