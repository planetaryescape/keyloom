// The DOM helper puts back what it found, so a test file that runs after a DOM test gets the globals it would have had alone.
import { expect, test } from "bun:test";
import { startDom } from "./dom.tsx";

const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown };

test("taking the document down puts back fetch and React's act flag", async () => {
  const hadFlag = "IS_REACT_ACT_ENVIRONMENT" in flags;
  const flag = flags.IS_REACT_ACT_ENVIRONMENT;
  const realFetch = globalThis.fetch;
  const tearDown = await startDom();
  expect(flags.IS_REACT_ACT_ENVIRONMENT).toBe(true);
  expect(typeof document).toBe("object");
  await tearDown();
  expect("IS_REACT_ACT_ENVIRONMENT" in flags).toBe(hadFlag);
  expect(flags.IS_REACT_ACT_ENVIRONMENT).toBe(flag);
  expect(globalThis.fetch).toBe(realFetch);
  expect(typeof document).toBe("undefined");
});
