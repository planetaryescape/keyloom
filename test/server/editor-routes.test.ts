import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiErrorBodySchema,
  ApplyResponseSchema,
  BuildSchema,
  CheckResponseSchema,
  FlashSchema,
  UndoResponseSchema,
} from "../../src/api/http.ts";
import { EditorError, type EditorBackend } from "../../src/server/editor-backend.ts";
import { startServer, type RunningServer } from "../../src/server/start-server.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { loadFixture } from "./fixture.ts";

const TOKEN = "test-token-0123456789";
const fixture = await loadFixture();
const AT = { layerId: "base", position: 0 };
const OPS = [{ op: "setBinding", at: AT, binding: { kind: "key", code: "F17" } }];

const quick = () => new FakeEditor(fixture, { buildMs: 200, flashStepMs: 100 });

let running: RunningServer | undefined;
afterEach(() => {
  running?.stop();
  running = undefined;
});

function start(editor?: EditorBackend) {
  const fake = new FakeEditor(fixture, { buildMs: 200, flashStepMs: 100 });
  running = startServer({ port: 0, source: fake.source(), ...(editor === undefined ? {} : { editor }), token: TOKEN });
  const port = Number(new URL(running.url).port);
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "x-keyloom-token": TOKEN, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return { fake, port, call };
}

describe("without an editor backend", () => {
  test("every write route is a 404, and the reads still work", async () => {
    const { call } = start();
    for (const [method, path] of [
      ["POST", "/api/layouts/moonlander-daily/check"],
      ["POST", "/api/layouts/moonlander-daily/apply"],
      ["POST", "/api/layouts/moonlander-daily/undo"],
      ["POST", "/api/layouts/moonlander-daily/builds"],
      ["GET", "/api/builds/x"],
      ["POST", "/api/builds/x/flashes"],
      ["GET", "/api/flashes/x"],
    ] as const) {
      expect((await call(method, path, method === "POST" ? {} : undefined)).status).toBe(404);
    }
    expect((await call("GET", "/api/layouts")).status).toBe(200);
  });
});

describe("guards", () => {
  test("the token is required on writes, and a foreign Host is refused first", async () => {
    const { fake, port } = start(quick());
    const url = `http://127.0.0.1:${port}/api/layouts/moonlander-daily/check`;
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
    expect((await fetch(url, init)).status).toBe(401);
    expect((await fetch(url, { ...init, headers: { ...init.headers, "x-keyloom-token": "wrong" } })).status).toBe(401);
    expect((await fetch(url, { ...init, headers: { ...init.headers, host: "evil.test", "x-keyloom-token": TOKEN } })).status).toBe(403);
    expect(fake.detail().revision.id).toBe(fixture.revision.id);
  });

  test("a POST that is not application/json is refused with 415 before anything runs", async () => {
    const { call } = start(quick());
    const response = await call("POST", "/api/layouts/moonlander-daily/apply", JSON.stringify({}), {
      "content-type": "text/plain",
    });
    expect(response.status).toBe(415);
    expect(ApiErrorBodySchema.parse(await response.json()).error.code).toBe("content_type");
    const form = await call("POST", "/api/layouts/moonlander-daily/apply", "a=b", {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(form.status).toBe(415);
  });

  test("the wrong method on an editor path is 405 with the allowed method", async () => {
    const { call } = start(quick());
    const get = await call("GET", "/api/layouts/moonlander-daily/check");
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const post = await call("POST", "/api/builds/x", {});
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
  });

  test("a body over the limit is refused", async () => {
    const { call } = start(quick());
    const big = JSON.stringify({ baseRevisionId: "x", ops: [], pad: "a".repeat(1_100_000) });
    const response = await call("POST", "/api/layouts/moonlander-daily/check", big);
    expect(response.status).toBe(413);
  });
});

describe("bodies are parsed with the shared schemas", () => {
  test("malformed JSON and schema failures are 400 with code schema", async () => {
    const { call } = start(quick());
    for (const body of ["{not json", {}, { baseRevisionId: "r", ops: [] }, { baseRevisionId: "r", ops: [{ op: "nope" }] }]) {
      const response = await call("POST", "/api/layouts/moonlander-daily/check", body);
      expect(response.status).toBe(400);
      expect(ApiErrorBodySchema.parse(await response.json()).error.code).toBe("schema");
    }
    const apply = await call("POST", "/api/layouts/moonlander-daily/apply", { baseRevisionId: "r", ops: OPS });
    expect(apply.status).toBe(400);
  });

  test("the flash body must be an empty object", async () => {
    const { call } = start(quick());
    expect((await call("POST", "/api/builds/b/flashes", { extra: 1 })).status).toBe(400);
  });
});

describe("the edit journey", () => {
  test("check, apply, undo and a stale undo", async () => {
    const { call } = start(quick());
    const checked = await call("POST", "/api/layouts/moonlander-daily/check", { baseRevisionId: fixture.revision.id, ops: OPS });
    expect(checked.status).toBe(200);
    expect(CheckResponseSchema.parse(await checked.json()).validation.ok).toBe(true);

    const applied = await call("POST", "/api/layouts/moonlander-daily/apply", {
      baseRevisionId: fixture.revision.id,
      ops: OPS,
      summary: "Base, key 1: F17",
    });
    expect(applied.status).toBe(200);
    const { revisionId } = ApplyResponseSchema.parse(await applied.json());

    const stale = await call("POST", "/api/layouts/moonlander-daily/apply", {
      baseRevisionId: fixture.revision.id,
      ops: OPS,
      summary: "again",
    });
    expect(stale.status).toBe(409);
    expect(ApiErrorBodySchema.parse(await stale.json()).error.code).toBe("stale_base");

    const wrongHead = await call("POST", "/api/layouts/moonlander-daily/undo", { revisionId: fixture.revision.id });
    expect(wrongHead.status).toBe(409);
    const undone = await call("POST", "/api/layouts/moonlander-daily/undo", { revisionId });
    expect(undone.status).toBe(200);
    expect(UndoResponseSchema.parse(await undone.json()).revisionId).not.toBe(revisionId);
  });

  test("an EditorError carries its status, code and validation to the browser", async () => {
    const bad = [{ op: "setBinding", at: { layerId: "base", position: 999 }, binding: { kind: "none" } }];
    const { call } = start(quick());
    const response = await call("POST", "/api/layouts/moonlander-daily/apply", {
      baseRevisionId: fixture.revision.id,
      ops: bad,
      summary: "x",
    });
    expect(response.status).toBe(409);
    const body = ApiErrorBodySchema.parse(await response.json());
    expect(body.error.code).toBe("invalid_ops");
    expect(body.validation?.errors[0]?.slots).toEqual([{ layerId: "base", position: 999 }]);
  });

  test("an error that is not an EditorError becomes a bare 500", async () => {
    const throwing = quick();
    throwing.check = async () => {
      throw new Error("disk on fire: /secret/path");
    };
    const { call } = start(throwing);
    const response = await call("POST", "/api/layouts/moonlander-daily/check", { baseRevisionId: "r", ops: OPS });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });

  test("an unknown ref is the backend's 404", async () => {
    const stub = quick();
    stub.check = async () => {
      throw new EditorError(404, "not_found", "No such layout.");
    };
    const { call } = start(stub);
    const response = await call("POST", "/api/layouts/nope/check", { baseRevisionId: "r", ops: OPS });
    expect(response.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await response.json()).error.code).toBe("not_found");
  });
});

describe("build and flash", () => {
  test("a build starts with 202, progresses, and can then be flashed", async () => {
    const { call } = start(quick());
    const started = await call("POST", "/api/layouts/moonlander-daily/builds", { revisionId: fixture.revision.id });
    expect(started.status).toBe(202);
    const build = BuildSchema.parse(await started.json());
    expect(build.status).toBe("running");

    const early = await call("POST", `/api/builds/${build.id}/flashes`, {});
    expect(early.status).toBe(409);

    await Bun.sleep(260);
    const done = BuildSchema.parse(await (await call("GET", `/api/builds/${build.id}`)).json());
    expect(done.status).toBe("succeeded");

    const flashStarted = await call("POST", `/api/builds/${build.id}/flashes`, {});
    expect(flashStarted.status).toBe(202);
    const flash = FlashSchema.parse(await flashStarted.json());
    expect(flash.status).toBe("waiting_for_bootloader");
    expect(flash.instruction).not.toBeNull();
    await Bun.sleep(230);
    const finished = FlashSchema.parse(await (await call("GET", `/api/flashes/${flash.id}`)).json());
    expect(finished.status).toBe("succeeded");
  });

  test("a build with no board revision can be refused 400 usage, and succeeds once one is sent", async () => {
    const { call } = start(new FakeEditor(fixture, { buildMs: 200, needsBoardRevision: true }));
    const refused = await call("POST", "/api/layouts/moonlander-daily/builds", { revisionId: fixture.revision.id });
    expect(refused.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await refused.json()).error.code).toBe("usage");
    const accepted = await call("POST", "/api/layouts/moonlander-daily/builds", { revisionId: fixture.revision.id, boardRevision: "revb" });
    expect(accepted.status).toBe(202);
  });

  test("unknown build and flash ids are 404 with ApiErrorBody", async () => {
    const { call } = start(quick());
    for (const path of ["/api/builds/nope", "/api/flashes/nope"]) {
      const response = await call("GET", path);
      expect(response.status).toBe(404);
      expect(ApiErrorBodySchema.parse(await response.json()).error.code).toBe("not_found");
    }
  });
});
