// Whether typed text looks like a password (07#warnings, macro_looks_like_secret). Firmware isn't a safe
// place for a secret: anyone with the keyboard can replay it. A guess from the text alone, so it only warns.

/** Eight or more characters with no spaces, mixing at least three of lower case, upper case, digits and symbols. */
export function looksLikeSecret(text: string): boolean {
  if (text.length < 8 || /\s/.test(text)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(text)).length;
  return classes >= 3;
}
