# keyloom-builder runner

The GitHub Actions runner on BK's Mac that takes keyloom's Apple Silicon CI and release jobs (D-483). It is a repository runner, set up like mxr's `mxr-builder`.

| What | Where |
|---|---|
| Runner | `~/.actions-runner/keyloom`, named `bk-m3max-keyloom`, labels `self-hosted,macOS,ARM64,keyloom-builder` |
| Service | launchd agent `actions.runner.planetaryescape-keyloom.bk-m3max-keyloom` (`./svc.sh status`) |
| PATH for jobs | `~/.actions-runner/keyloom/.path`: Homebrew and system directories only |
| Job guard | `ACTIONS_RUNNER_HOOK_JOB_STARTED` in `~/.actions-runner/keyloom/.env`, pointing at an installed copy of `job-started.sh` |

`job-started.sh` is what keeps other people's code off the Mac. The runner runs the installed copy, so editing the one in this folder changes nothing until it is installed again:

```sh
install -m 0755 infra/keyloom-builder/job-started.sh ~/.actions-runner/keyloom/job-started.sh
```

Changes to `.env` or `.path` take effect after `./svc.sh stop && ./svc.sh start` in the runner folder. Wait until the runner isn't busy first: stopping it cancels the job it is running.
