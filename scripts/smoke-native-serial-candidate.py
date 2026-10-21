"""PTY driver for the installed, compile-paired synthetic serial capture smoke. Never selects a device/backend."""
import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time

binary, data, layout, cache = sys.argv[1:]
env = {"PATH": "/usr/bin:/bin", "HOME": os.path.dirname(data), "XDG_CACHE_HOME": cache}

def record(interrupt):
    master, slave = pty.openpty()
    proc = subprocess.Popen([binary, "--data-dir", data, "--format", "jsonl", "lab", "start", layout, "--text", "sdsd"], stdin=slave, stdout=slave, stderr=slave, env=env)
    os.close(slave)
    output = bytearray()
    acted = False
    helper = None
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(master, 4096)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > 65536:
                    raise RuntimeError("bounded PTY output exceeded")
            if not acted and b"typed:" in output:
                children = subprocess.run(["/usr/bin/pgrep", "-P", str(proc.pid)], capture_output=True, timeout=2, env=env)
                ids = children.stdout.decode().split()
                if len(ids) != 1:
                    raise RuntimeError("expected one owned synthetic helper child")
                helper = int(ids[0])
                os.kill(helper, 0)
                os.write(master, b"sdsd")
                time.sleep(0.15)
                if interrupt:
                    os.kill(helper, signal.SIGKILL)
                else:
                    os.write(master, b"\x03")
                acted = True
            if proc.poll() is not None and not ready:
                break
        if proc.wait(timeout=2) != 0:
            raise RuntimeError("installed lab failed: " + output.decode(errors="replace"))
        if not acted or helper is None:
            raise RuntimeError("lab never reached native capture")
        # CLI cleanup must observe helper exit; kill requested alone is not acceptance.
        try:
            os.kill(helper, 0)
        except ProcessLookupError:
            pass
        else:
            raise RuntimeError("helper remained after installed CLI completion")
        results = []
        for line in output.decode().splitlines():
            if line.startswith('{"schema_version":'):
                value = json.loads(line)
                if "session_id" in value:
                    results.append(value)
        if len(results) != 1 or results[0]["key_events"] != 2:
            raise RuntimeError("missing native firmware trace: " + output.decode(errors="replace"))
        result = results[0]
        if interrupt:
            if result["ended_by"] == "host" or not any(w.startswith("Recording incomplete:") for w in result["warnings"]):
                raise RuntimeError("helper death became a complete recording")
        elif result["ended_by"] != "host" or result["warnings"]:
            raise RuntimeError("normal native stop was not complete")
        return result
    finally:
        if helper is not None and proc.poll() is None:
            children = subprocess.run(["/usr/bin/pgrep", "-P", str(proc.pid)], capture_output=True, timeout=2, env=env)
            if str(helper) in children.stdout.decode().split():
                try:
                    os.kill(helper, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=2)
        os.close(master)

records = [record(False), record(False), record(True)]
print(json.dumps({"syntheticOnly": True, "installedPtyRecords": records, "stopReopen": True, "helperDeathIncomplete": True, "helperExitObserved": True}))
