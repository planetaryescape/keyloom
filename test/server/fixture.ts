import { LayoutDetailSchema, type LayoutDetail } from "../../src/server/responses.ts";

// The Moonlander sample used by the server and viewer tests. Parsed on load so a broken
// fixture fails here, not in a confusing assertion further down.
export async function loadFixture(): Promise<LayoutDetail> {
  const path = new URL("../fixtures/web/moonlander-sample.json", import.meta.url);
  return LayoutDetailSchema.parse(JSON.parse(await Bun.file(path).text()));
}
