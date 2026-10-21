import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { tempDir } from "../../helpers/tmp.ts";
import { DeviceTransportClient, DeviceTransportError } from "../../../src/firmware/toolchain/device-helper/transport-client.ts";
import { manifestSchema } from "../../../src/firmware/toolchain/device-helper/extract.ts";

async function rejectedResult<T>(operation: Promise<T>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected transport operation to reject");
}

function expectTransportError(error: unknown, code: DeviceTransportError["detail"]["code"], effect: DeviceTransportError["detail"]["effect"]): void {
  if (!(error instanceof DeviceTransportError)) throw new Error("expected a DeviceTransportError");
  expect(error.detail.code).toBe(code);
  expect(error.detail.effect).toBe(effect);
}

function fixture(mode: string) {
  const script = join(tempDir(), "synthetic-stdio.ts");
  writeFileSync(script, `
const mode=${JSON.stringify(mode)};
const send=v=>process.stdout.write(JSON.stringify(v)+"\\n");
const event=(seq,event,extra={})=>({v:1,type:"event",sessionId:"s1",seq,event,...extra});
const data=seq=>event(seq,"data",{receivedAtUs:String(seq),bytes:Buffer.alloc(32).toString("base64")});
let buffer="", seq=0, held;
for await (const chunk of Bun.stdin.stream()) {
 buffer+=new TextDecoder().decode(chunk);
 let end;
 while((end=buffer.indexOf("\\n"))>=0) {
  const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
  const reply=result=>send({v:1,type:"response",id:r.id,ok:true,result});
  if(r.method==="hello") {reply({protocol:1,helperVersion:r.params.hostVersion,target:r.params.target,capabilities:["hid.list","hid.open","hid.write"]});continue;}
  if(r.method==="hid.open") {
   if(mode==="before") send(data(1));
   reply({sessionId:"s1"});
   if(mode==="gap") send(data(2));
   if(mode==="badsize") send(event(1,"data",{receivedAtUs:"1",bytes:"AA=="}));
   if(mode==="wrongterminal") send(event(1,"closed",{reason:"failed"}));
   if(mode==="burst") {let lines="";for(let i=1;i<=2000;i++)lines+=JSON.stringify(data(i))+"\\n";seq=2000;process.stdout.write(lines);}
   continue;
  }
  if(r.method==="session.close") {
   send(event(++seq,"closed",{reason:"requested"}));reply({finalSeq:seq});
   if(mode==="late") send(data(seq+1));
   continue;
  }
  if(r.method==="first") {held={v:1,type:"response",id:r.id,ok:true,result:1};continue;}
  if(r.method==="second") {reply(2);send(held);continue;}
  if(r.method==="never") continue;
  if(r.method==="shutdown") {reply({});process.exit(0);}
  reply({});
 }
}
`);
  let launches = 0;
  const launch = () => { launches++; return Bun.spawn([process.execPath, script], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" }); };
  const manifest = manifestSchema.parse({ protocol: 1, release: "0.0.0", target: "aarch64-apple-darwin", sha256: "0".repeat(64) });
  return { connect: () => DeviceTransportClient.connect(script, manifest, launch), launches: () => launches };
}
for (const mode of ["before", "gap", "badsize", "wrongterminal"]) {
  test(`${mode} delivery fails the channel, without restart or complete capture`, async () => {
    const fake = fixture(mode), client = await fake.connect();
    const failure = Promise.withResolvers<Error>();
    let delivered = 0;
    try {
      const opened = client.open("d1", () => { delivered++; }, failure.resolve);
      if (mode === "before") expectTransportError(await rejectedResult(opened), "protocol_error", "possible");
      else { await opened; expect((await failure.promise).message).toContain("protocol_error"); }
      expectTransportError(await rejectedResult(client.request("ping", {}, z.object({}), 500)), "protocol_error", "possible");
      expect(fake.launches()).toBe(1);
      expect(delivered).toBe(0);
    } finally { await client.terminate(); }
  });
}
test("joined stream larger than one frame remains ordered; responses may reorder", async () => {
  const fake = fixture("burst"), client = await fake.connect();
  let count = 0;
  try {
    const session = await client.open("d1", () => { count++; }, () => {});
    const replies = await Promise.all([client.request("first", {}, z.literal(1), 500), client.request("second", {}, z.literal(2), 500)]);
    expect(replies).toEqual([1, 2]);
    await client.close(session);
    expect(count).toBe(2000);
  } finally { await client.shutdown(); }
});
test("an event after finalSeq invalidates the channel and completed close is cached", async () => {
  const fake = fixture("late"), client = await fake.connect();
  try {
    const session = await client.open("d1", () => {}, () => {});
    await client.close(session);
    await client.close(session);
    expectTransportError(await rejectedResult(client.request("ping", {}, z.object({}), 500)), "protocol_error", "possible");
  } finally { await client.terminate(); }
});
test("pending budget refuses before write; deadline fails all siblings and no reconnect occurs", async () => {
  const fake = fixture("valid"), client = await fake.connect();
  try {
    const waiting = Array.from({ length: 32 }, () => client.request("never", {}, z.unknown(), 100));
    await expect(client.request("never", {}, z.unknown(), 100)).rejects.toThrow("capacity");
    const results = await Promise.allSettled(waiting);
    expect(results.every((r) => r.status === "rejected" && r.reason.message.includes("timeout"))).toBe(true);
    expect(fake.launches()).toBe(1);
  } finally { await client.terminate(); }
});
