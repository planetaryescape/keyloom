// The LaunchDaemon that runs kanata as root (21, D-231). keyloom writes the text and BK installs it with the one
// command the doctor prints; keyloom never holds sudo. Written from keyloom's own template, not copied from kanata's samples.
export const DAEMON_LABEL = "dev.keyloom.kanata";
export const DAEMON_PLIST_PATH = `/Library/LaunchDaemons/${DAEMON_LABEL}.plist`;

export type PlistInput = {
  /** Absolute path of the kanata binary. */
  kanataPath: string;
  /** Absolute path of keyloom.kbd, in BK's home folder. */
  configPath: string;
  port: number;
};

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchDaemonPlist(i: PlistInput): string {
  const args = [i.kanataPath, "-c", i.configPath, "-p", `127.0.0.1:${i.port}`, "--release-grab-on-lock", "--quiet"];
  // KeepAlive restarts kanata only after a crash. The emergency chord (Left Control + Space + Escape) exits with code 0,
  // so launchd leaves it stopped, which is the way out that works with no other keyboard.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>UserName</key>
  <string>root</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>/var/log/keyloom-kanata.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/keyloom-kanata.log</string>
</dict>
</plist>
`;
}
