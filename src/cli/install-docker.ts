// `keyloom doctor --install-docker` (D-030 parity with the Install Docker button, D-488): the same install the page runs,
// with Homebrew's output streamed to the terminal instead of polled.
import { type InstallDeps, type InstallOutcome, installTool } from "../app/tool-install.ts";
import { type DockerStatus, dockerStatus } from "../app/toolchain.ts";

/**
 * Installs Docker (Colima on a Mac with Homebrew) and starts it, saying each line. Returns the outcome for the caller's exit code.
 * It installs only where there is no Docker: beside Docker Desktop or OrbStack, a second `docker` from Homebrew could shadow the app's.
 */
export async function installDockerWithProgress(say: (line: string) => void, deps: InstallDeps & { status?: () => Promise<DockerStatus> } = {}, signal?: AbortSignal): Promise<InstallOutcome> {
  const { status = () => dockerStatus(), ...installDeps } = deps;
  const now = await status();
  if (now.ok) {
    say(`keyloom: Docker ${now.version} is already installed and running, so nothing was installed`);
    return { ok: true };
  }
  if (now.kind !== "not-installed") {
    const next = now.kind === "daemon-down" || now.kind === "slow" ? " Run `keyloom doctor --start-docker` to start it." : "";
    say(`keyloom: Docker is already on this computer, so nothing was installed. ${now.reason}${next}`);
    return { ok: true };
  }
  const outcome = await installTool("docker", say, installDeps, (phase) => {
    if (phase === "starting") say("keyloom: Docker is installed; starting it (the first start downloads a small virtual machine)");
  }, signal);
  if (outcome.ok) say("keyloom: Docker is installed and running");
  else if (outcome.code === "no_brew") say(`keyloom: ${outcome.reason} The docker check below names the page to install it from.`);
  else if (outcome.code === "start_failed") say(`keyloom: Docker is installed, but it didn't start: ${outcome.reason} Run \`keyloom doctor --start-docker\` to try again.`);
  else if (outcome.code === "cancelled") say("keyloom: stopped the install; Docker is not ready");
  else say(`keyloom: Docker didn't install: ${outcome.reason}`);
  return outcome;
}
