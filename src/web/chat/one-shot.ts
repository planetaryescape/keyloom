/**
 * A request the shell asks the chat to make once per id (D-461). React runs a mount effect twice in strict mode, and a re-render must not
 * repeat the request either, so the ids already taken are kept here; a new id (a second press) starts again.
 */
export type OneShot = { take: (id: string | undefined) => boolean };

export function createOneShot(handled: Set<string> = new Set()): OneShot {
  return {
    take(id: string | undefined): boolean {
      if (id === undefined || handled.has(id)) return false;
      handled.add(id);
      return true;
    },
  };
}

/** Runs `start` the first time this id is seen, and not again for the same id. */
export function sendOnce(once: OneShot, id: string | undefined, start: () => void): void {
  if (once.take(id)) start();
}
