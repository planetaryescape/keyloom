# The Windows smoke script can fail its own cleanup after every check passes

`scripts/smoke-windows-native.ps1` removes its scratch folder in a `finally` block (line 71 at 766da2f). On PR 163's CI, `device-helper-windows-candidate` (run 39811254688) passed the doctor check, then `Remove-Item -Recurse -Force` failed with "The process cannot access the file …" and the job failed. The same job on the same commit passed in run 39811247031. Windows hadn't yet released a file under the scratch folder, most likely the helper executable or its lease, when the script tried to delete it.

Proposed fix: retry the removal for a few seconds. If it still fails, warn instead of failing the job, because cleanup isn't one of the checks.

Status: fixed in fe968bc (PR 170), released in v0.54.0.
Cleanup retries for up to 10 seconds and warns if the runner still holds a file lock, so cleanup cannot fail an otherwise passing smoke run. PowerShell syntax validation could not run locally because `pwsh` is not installed.
