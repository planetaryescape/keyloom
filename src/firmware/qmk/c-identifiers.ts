// Generation is synchronous, so this lexical scan avoids another asynchronous tree-sitter parse.
const TOKENS = /#(?:[ \t]|\/\*[\s\S]*?\*\/)*include(?:[ \t]|\/\*[\s\S]*?\*\/)*(?:<[^>\r\n]*>|"(?:\\[\s\S]|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|(?:u8|[uUL])?"(?:\\[\s\S]|[^"\\])*"|(?:u8|[uUL])?'(?:\\[\s\S]|[^'\\])*'|(?:\d|\.\d)(?:[eEpP][+-]?|[\w.])*|([A-Za-z_]\w*)/g;

export function refersToIdentifier(source: string, names: ReadonlySet<string>): boolean {
  // C splices continued lines before recognizing comments or literals.
  for (const match of source.replace(/\\\r?\n/g, "").matchAll(TOKENS)) {
    if (match[1] !== undefined && names.has(match[1])) return true;
  }
  return false;
}
