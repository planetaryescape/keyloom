# Starting the Docker engine instead of stopping the person

Business process note, 2026-11-10, for [D-486](../blueprint/14-decision-log.md#d-486-keyloom-starts-the-docker-engine-itself-and-says-where-it-cant-instead-of-stopping-at-docker-isnt-running-bk-there-could-be-a-button-here-that-the-user-can-just-click-to-resolve-it-or-better-yet-since-this-is-so-integral-to-the-functioning-of-the-app-just-start-the-daemon-yourself-do-we-really-need-docker-theres-no-other-way-to-do-it).

## What BK saw

Build and flash ended at `Docker isn't running. Start Docker Desktop and build again.` with a "Build again" button that fails the same way. The person is told to leave the app, find an application they did not know was involved, start it, wait, and come back. BK asked for three things: a button that resolves it, keyloom starting the daemon itself, and permission stated once; and asked whether Docker is needed at all.

## Is Docker needed?

Every board's build is a Docker run today:

| Board | What it needs | Where |
|---|---|---|
| ZSA Moonlander | ZSA's `qmk_firmware` fork at a pinned SHA, five submodules, `qmk/qmk_cli` image | [05](../blueprint/05-firmware-qmk.md) |
| MoErgo Glove80 | keyloom's own image over the pinned ZMK ref, Nix store with Zephyr and the host gcc `native_posix_64` needs | [06](../blueprint/06-firmware-zmk.md) |
| foostan Corne, Keebart Corne | `west build` against upstream ZMK, or a pinned hardware module | [06](../blueprint/06-firmware-zmk.md) |
| MacBook | kanata, a config file, no build | [21](../blueprint/21-macbook-keyboard.md) |

The alternatives, and why they lost:

- **Host toolchains.** QMK wants `arm-none-eabi-gcc` at the version the pinned image carries plus Python deps; ZMK wants `west`, the Zephyr SDK and a module per board, several gigabytes; the Keebart board wants a pinned hardware module. Three installs, three upgrade paths, and a build keyloom cannot reproduce when a person's `arm-none-eabi-gcc` differs from the one that built the same layout elsewhere. It also breaks "the same source produces the same firmware" across BK's Mac, CI and a contributor's laptop.
- **A hosted build service.** Contradicts local-first and the no-backend rule (D-001), and needs somewhere to hold every layout's source.
- **Shipping a toolchain inside the app.** The release is already 68 MB of sidecar; Zephyr and three compilers are an order of magnitude larger, per platform.

Docker stays. What changed is that a closed engine is keyloom's problem, not the person's.

## What was observed

**BK's Mac, 2026-11-10.** `docker context show` says `colima`. `colima status` said "colima is running using macOS Virtualization.Framework", but `docker version` refused: `Cannot connect to the Docker daemon at unix:///Users/bhekanik/.colima/default/docker.sock`, with a stale socket from 2026-11-03. So the VM is up and the daemon inside it is wedged: `colima start` would answer "already running" and change nothing. That is why `detectDockerEngine` asks `colima list --json` and picks `colima restart` for a VM that is already running.

`bun src/cli/main.ts doctor --start-docker --data-dir <scratch>`:

```
keyloom: Docker isn't answering, so restarting Colima (a cold start can take half a minute)
keyloom: Colima is up after 56 s
ok    docker: running, server 28.4.0
ok    docker disk: 251.4 GB free in Docker's disk
...
```

The daemon that had been unreachable since 3 November answered after the restart, and every toolchain check behind it passed. Nothing was flashed.

**The screenshots** are the release dialog over an imported Moonlander fixture on a scratch data directory at 1440×900 and 390×844, taken with the page served by a real `keyloom serve` whose PATH held a fake `docker` that refuses `docker version`:

- [note-1440x900.png](docker-start/note-1440x900.png) and [note-390x844.png](docker-start/note-390x844.png): "Docker isn't answering. keyloom starts Colima when you build." with Start it now. The line wraps under the text on a phone rather than squeezing it.
- [missing-1440x900.png](docker-start/missing-1440x900.png): with no docker on PATH at all, the callout says firmware is built in Docker, links the install, and offers Check again.

## The engines keyloom does not ship (D-487)

The first version knew Docker Desktop, OrbStack, Colima and systemd, and treated anything else as "nothing to start". The `docker` CLI's context is the fingerprint instead: `docker context inspect <name> --format {{.Endpoints.docker.Host}}` names the socket, and the socket names the engine.

| Context or socket | Engine | What keyloom runs |
|---|---|---|
| `desktop-linux`, `~/.docker/run/docker.sock`, `/var/run/docker.sock` | Docker Desktop | `open -a Docker`; `systemctl --user start docker-desktop` on Linux |
| `orbstack`, `~/.orbstack/run/docker.sock` | OrbStack | `open -a OrbStack` |
| `colima`, `~/.colima/<profile>/docker.sock` | Colima | `colima start`, or `colima restart` when the VM is up |
| `rancher-desktop`, `~/.rd/docker.sock` | Rancher Desktop | `open -a "Rancher Desktop"` |
| `podman`, `…/podman/machine/podman.sock` | Podman | `podman machine start`, or `open -a "Podman Desktop"` |
| `~/.lima/<vm>/sock/docker.sock` | Lima | `limactl start <vm>` |
| `default` on Linux | the Docker service | `systemctl start docker` |
| `ssh://`, non-loopback `tcp://`, `http(s)://`, `npipe://` | another machine | nothing; the sentence names the address |
| any other local socket | a tool keyloom has never launched | nothing; the sentence names the context and socket |

Where there is no engine at all, the answer is an install rather than a start: `dockerInstall(platform)` returns `brew install --cask docker` on a Mac with Homebrew, `winget install --id Docker.DockerDesktop -e` on Windows, or the distribution's page on Linux. An engine whose app is installed but whose `docker` command never reached the PATH is a third case, `cli-missing`, and its sentence names the symlink instead of asking for an install that already happened.

- [install-1440x900.png](docker-start/install-1440x900.png): no Docker, with Homebrew present. The command is one unbroken token, the page is linked, and OrbStack is offered as the lighter alternative.
- [remote-1440x900.png](docker-start/remote-1440x900.png): a context pointing at `ssh://builder@build.example.com`. keyloom says where the engine is and that it starts only the one on this computer, rather than pretending to start something.

Both were taken through a real `keyloom serve` on a scratch data directory with a fake `docker` (refusing `version`, naming a remote context) and a fake `brew` on the PATH.

The `cli-missing` callout has no screenshot: it needs a macOS app bundle that is absent here.

## What was not observed

- A cold start of Docker Desktop, OrbStack, Rancher Desktop, Podman or Lima: none is installed on BK's Mac. Their paths are `open -a <app>`, `podman machine start` and `limactl start`, matched by the sockets in the table above, and are unit-tested but never run on a machine that has them.
- `systemctl start docker` on Linux, including the permission failure the hint names.
- A build that starts an engine and then finishes: the engine start is proven on its own, and the build path is proven with fake toolchains in `test/app/firmware.test.ts` and `test/app/firmware-zmk.test.ts`.
- Windows: builds are refused there (D-435), so the engine is not started either.
