#!/bin/sh
# Job-started hook for the keyloom-builder runner on BK's Mac (D-483). The runner runs it before every job
# and fails the job when it exits non-zero, before any of the job's steps or code run.
#
# Workflow files can't be trusted to keep other people off this machine: a pull request runs its own copy of
# them, so a fork can ask for this runner by label. This copy is installed outside the repository and is the
# check a workflow edit can't remove. It allows only runs BK started (a push or a manual dispatch), and
# release.yml dispatching ci.yml on the release PR, which only BK's push to main can start.
set -eu

refuse() {
  echo "::error::keyloom-builder runs only BK's own work; refusing $1 (event ${GITHUB_EVENT_NAME:-unset}, actor ${GITHUB_ACTOR:-unset}, triggered by ${GITHUB_TRIGGERING_ACTOR:-unset}, repository ${GITHUB_REPOSITORY:-unset})."
  exit 1
}

[ "${GITHUB_REPOSITORY:-}" = planetaryescape/keyloom ] || refuse "another repository"

case "${GITHUB_TRIGGERING_ACTOR:-}" in
  bhekanik | "github-actions[bot]") ;;
  *) refuse "a run someone else triggered" ;;
esac

case "${GITHUB_EVENT_NAME:-}:${GITHUB_ACTOR:-}" in
  push:bhekanik | workflow_dispatch:bhekanik) ;;
  # GITHUB_TOKEN dispatches come only from this repository's workflows; a fork's token can't dispatch.
  "workflow_dispatch:github-actions[bot]") ;;
  *) refuse "this event" ;;
esac

echo "keyloom-builder: ${GITHUB_EVENT_NAME} by ${GITHUB_ACTOR} (triggered by ${GITHUB_TRIGGERING_ACTOR}) is allowed."
