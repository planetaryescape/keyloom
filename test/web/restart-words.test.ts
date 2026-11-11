import { expect, test } from "bun:test";
import { afterRestart } from "../../src/web/shell/restart-words.ts";
import { restartCommand } from "../../src/cli/serve.ts";

test("an answered restart, or one whose answer was cut off by the stop, is restarting (R5-15)", () => {
  expect(afterRestart(null, "keyloom serve")).toEqual({ kind: "restarting" });
  expect(afterRestart({ status: 0, code: "unreachable", message: "keyloom stopped answering." }, "keyloom serve")).toEqual({ kind: "restarting" });
});

test("a server with no app to start it again shows the terminal line; any other refusal says so and can be asked again", () => {
  expect(afterRestart({ status: 409, code: "restart_unsupervised", message: "runs in a terminal" }, "keyloom serve")).toEqual({ kind: "terminal", command: "keyloom serve" });
  const failed = afterRestart({ status: 500, code: "internal", message: "internal error" }, "keyloom serve");
  expect(failed).toEqual({ kind: "failed", message: "keyloom didn't restart. internal error" });
});

test("the terminal line starts keyloom the way it was started", () => {
  expect(restartCommand({ port: "4477" })).toBe("keyloom serve");
  expect(restartCommand({ dataDir: "/Users/me/My Keys", port: "4500", provider: "codex" })).toBe("keyloom --data-dir '/Users/me/My Keys' serve --port 4500 --provider codex");
  expect(restartCommand({ dataDir: "/tmp/it's", port: "4477" })).toBe("keyloom --data-dir '/tmp/it'\\''s' serve");
});
