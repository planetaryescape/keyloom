import { timingSafeEqual } from "node:crypto";

// Host is checked before the token, so a DNS-rebound request gets 403 whatever it carries.
// The exact string match rejects `localhost.`, a missing port and any other host name.
export function checkHost(request: Request, port: number): Response | null {
  const host = request.headers.get("host")?.toLowerCase();
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return null;
  return new Response("forbidden host", { status: 403 });
}

export function checkToken(request: Request, token: string): Response | null {
  const given = request.headers.get("x-keyloom-token");
  if (given === null) return unauthorized();
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(token);
  if (givenBytes.length !== expectedBytes.length) return unauthorized();
  return timingSafeEqual(givenBytes, expectedBytes) ? null : unauthorized();
}

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}
