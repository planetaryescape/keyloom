import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiErrorBodySchema,
  ApplyResponseSchema,
  BoardListResponseSchema,
  ImportResponseSchema,
  RevisionListResponseSchema,
  BuildSchema,
  CheckResponseSchema,
  FlashSchema,
  LayoutExportDocumentSchema,
  ParseBindingResponseSchema,
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

describe("export", () => {
  test("serves the head's keyloom document, a named revision with ?rev=, and a 404 for an unknown one", async () => {
    const { call } = start(quick());
    const head = await call("GET", "/api/layouts/moonlander-daily/export");
    expect(head.status).toBe(200);
    const document = LayoutExportDocumentSchema.parse(await head.json());
    expect(document).toMatchObject({ kind: "keyloom-layout", schema_version: 1, board_id: fixture.board.id, layout_name: "Daily driver", revision_id: fixture.revision.id });

    const applied = await call("POST", "/api/layouts/moonlander-daily/apply", { baseRevisionId: fixture.revision.id, ops: OPS, summary: "Base, key 1: F17" });
    expect(applied.status).toBe(200);
    const { revisionId } = ApplyResponseSchema.parse(await applied.json());
    const newHead = LayoutExportDocumentSchema.parse(await (await call("GET", "/api/layouts/moonlander-daily/export")).json());
    expect(newHead.revision_id).toBe(revisionId);

    const old = await call("GET", `/api/layouts/moonlander-daily/export?rev=${fixture.revision.id}`);
    expect(LayoutExportDocumentSchema.parse(await old.json()).revision_id).toBe(fixture.revision.id);
    expect((await call("GET", "/api/layouts/moonlander-daily/export?rev=rev_nope")).status).toBe(404);
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

describe("parse-binding (the Any field)", () => {
  test("answers a binding, needs JSON and POST, and refuses a body without an expression", async () => {
    const { call } = start(quick());
    const ok = await call("POST", "/api/layouts/moonlander-daily/parse-binding", { expression: "LCTL_T(KC_A)", position: 3 });
    expect(ok.status).toBe(200);
    expect(ParseBindingResponseSchema.parse(await ok.json()).ok).toBe(true);
    const missing = await call("POST", "/api/layouts/moonlander-daily/parse-binding", {});
    expect(missing.status).toBe(400);
    expect((await call("GET", "/api/layouts/moonlander-daily/parse-binding")).status).toBe(405);
    expect((await call("POST", "/api/layouts/moonlander-daily/parse-binding", "x=1", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
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

describe("applying a stored proposal", () => {
  const ops = OPS as Parameters<FakeEditor["storeProposal"]>[0];

  test("POST /api/change-sets/:id/apply applies it, supersedes its sibling and refuses a second apply", async () => {
    const editor = quick();
    const { call } = start(editor);
    const first = editor.storeProposal(ops, "Base, key 1: F17", "turn-1");
    const sibling = editor.storeProposal(ops, "Base, key 1: F17 again", "turn-1");

    const applied = await call("POST", `/api/change-sets/${first.id}/apply`, {});
    expect(applied.status).toBe(200);
    const body = ApplyResponseSchema.parse(await applied.json());
    expect(body.changeSetId).toBe(first.id);
    expect(editor.detail().revision.id).toBe(body.revisionId);
    expect(editor.proposalStatus(sibling.id)).toBe("superseded");

    const again = await call("POST", `/api/change-sets/${first.id}/apply`, {});
    expect(again.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await again.json()).error.code).toBe("usage");
  });

  test("an unknown id is 404, a proposal made against an older head is 409 stale_base", async () => {
    const editor = quick();
    const { call } = start(editor);
    expect((await call("POST", "/api/change-sets/nope/apply", {})).status).toBe(404);

    const old = editor.storeProposal(ops, "old", "turn-1");
    await call("POST", "/api/layouts/moonlander-daily/apply", { baseRevisionId: fixture.revision.id, ops: OPS, summary: "moved on" });
    const stale = await call("POST", `/api/change-sets/${old.id}/apply`, {});
    expect(stale.status).toBe(409);
    expect(ApiErrorBodySchema.parse(await stale.json()).error.code).toBe("stale_base");
  });

  test("the token, the content type and an empty body are required, and GET is 405", async () => {
    const editor = quick();
    const { port, call } = start(editor);
    const url = `http://127.0.0.1:${port}/api/change-sets/x/apply`;
    expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await call("POST", "/api/change-sets/x/apply", "{}", { "content-type": "text/plain" })).status).toBe(415);
    expect((await call("POST", "/api/change-sets/x/apply", { extra: 1 })).status).toBe(400);
    expect((await call("GET", "/api/change-sets/x/apply")).status).toBe(405);
  });
});

describe("history, boards and import", () => {
  test("revisions come newest first with the head marked, and going back is one undo with `to`", async () => {
    const editor = quick();
    const { call } = start(editor);
    await call("POST", "/api/layouts/moonlander-daily/apply", { baseRevisionId: fixture.revision.id, ops: OPS, summary: "first" });
    const head = (await (await call("GET", "/api/layouts/moonlander-daily/revisions")).json()).revisions[0].id;
    const back = await call("POST", "/api/layouts/moonlander-daily/undo", { revisionId: head, to: fixture.revision.id });
    expect(back.status).toBe(200);
    const list = RevisionListResponseSchema.parse(await (await call("GET", "/api/layouts/moonlander-daily/revisions")).json()).revisions;
    expect(list.map((r) => r.isHead)).toEqual([true, false, false].slice(0, list.length));
    expect(list.at(-1)?.origin).toBe("import");
    expect((await call("POST", "/api/layouts/moonlander-daily/revisions", {})).status).toBe(405);
  });

  test("the board list names the boards the import screen offers", async () => {
    const { call } = start(quick());
    const boards = BoardListResponseSchema.parse(await (await call("GET", "/api/boards")).json()).boards;
    expect(boards.map((b) => b.id)).toContain("zsa/moonlander");
  });

  test("an upload needs octet-stream, a board and a filename, and answers 201 with the new layout", async () => {
    const { call } = start(quick());
    const file = new Uint8Array([80, 75, 3, 4]);
    const octet = { "content-type": "application/octet-stream" };
    expect((await call("POST", "/api/import?board=zsa/moonlander&filename=a.zip", file as unknown as string, {})).status).toBe(415);
    expect((await call("POST", "/api/import?filename=a.zip", file as unknown as string, octet)).status).toBe(400);
    expect((await call("POST", "/api/import?board=zsa/moonlander&filename=a.txt", file as unknown as string, octet)).status).toBe(400);
    const ok = await call("POST", "/api/import?board=zsa/moonlander&filename=a.zip", file as unknown as string, octet);
    expect(ok.status).toBe(201);
    expect(ImportResponseSchema.parse(await ok.json()).name).toBe("a");
    expect((await call("GET", "/api/import")).status).toBe(405);
  });

  test("a form post can't import: only the token and octet-stream together get through", async () => {
    const { port } = start(quick());
    const res = await fetch(`http://127.0.0.1:${port}/api/import?board=zsa/moonlander&filename=a.zip`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "x" });
    expect(res.status).toBe(401);
  });
});
