// A name put into a command the terminal suggests, such as a layout called "My Layout": quoted when a shell would split or expand it,
// so the line can be pasted as it is, and left bare when it is plain, so the common case reads like the docs.
const PLAIN = /^[A-Za-z0-9._\-/:@+=,]+$/;

export function commandArg(value: string): string {
  return PLAIN.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
