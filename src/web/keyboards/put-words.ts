// What the Put step says when keyloom couldn't map a config onto the new board (R6-05). The spinner gives way to this: a failure keyloom
// can get past by asking again offers Try again; a refusal says why and offers another config or a config of the board's own.
import { ApiError } from "../api.ts";

export type PutProblem = {
  text: string;
  /** No answer or a server failure: the same request can work the next time. A refusal (4xx) fails the same way, so it has no Try again. */
  retry: boolean;
};

export function putProblem(error: unknown, boardName: string): PutProblem {
  const status = error instanceof ApiError ? error.status : 0;
  const code = error instanceof ApiError ? error.code : undefined;
  if (status === 0 || code === "unreachable") return { text: `keyloom stopped answering, so it couldn't map this config onto the ${boardName}.`, retry: true };
  if (status >= 500) return { text: `keyloom couldn't map this config onto the ${boardName}.`, retry: true };
  if (code === "not_found") return { text: "keyloom can't find that config any more. It may have been deleted.", retry: false };
  const why = error instanceof Error ? error.message.replace(/\.$/, "") : "";
  return { text: `keyloom can't put this config on the ${boardName}${why === "" ? "." : `: ${why}.`}`, retry: false };
}
