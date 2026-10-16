// Enforces docs/blueprint/01-architecture.md "Modules". Run: bun run depcruise
// Each folder may import itself, npm packages, and the folders listed for it. src/layout and
// src/validation are pure: no node:, bun: or fs access, so the validator can run in the browser.

/** @type {Record<string, string[]>} */
const ALLOWED = {
  layout: [],
  validation: ["layout", "boards"],
  boards: ["layout"],
  "firmware/qmk": ["layout", "boards", "firmware/toolchain", "firmware/emulate"],
  "firmware/zmk": ["layout", "boards", "firmware/toolchain", "firmware/emulate"],
  "firmware/kanata": ["layout", "boards"],
  "firmware/emulate": ["layout", "boards", "firmware/toolchain"],
  "firmware/toolchain": [],
  agent: ["layout", "validation", "boards", "memory"],
  lab: ["layout", "boards", "firmware"], // the typing lab's analysis (24-typing-lab.md); app wires it to the keyboard and the database
  memory: ["layout", "persistence"],
  persistence: ["layout"],
  app: ["layout", "validation", "boards", "firmware", "agent", "lab", "memory", "persistence"],
  api: ["layout", "boards", "validation"], // the HTTP wire contract shared by server and web
  server: ["app", "api", "layout", "boards", "validation", "web"], // web: the bundled HTML entry it serves; layout/boards/validation: schema types
  cli: ["app", "server"], // the CLI entry point composes the server (keyloom serve)
  web: ["layout", "boards", "validation", "api"], // validation runs in the browser for instant feedback
  // Ambient module declarations; nothing imports them.
  types: [],
};

const FOLDERS = Object.keys(ALLOWED);
// "firmware" is a parent of firmware/qmk etc.; app may import any of them.
const ALL = [...FOLDERS, "firmware"];

const folderPattern = (f) => `^src/${f}/`;

const forbidden = FOLDERS.map((from) => {
  const allowed = new Set([from, ...ALLOWED[from]]);
  const notAllowed = ALL.filter((f) => ![...allowed].some((a) => a === f || a.startsWith(`${f}/`) || f.startsWith(`${a}/`)));
  return {
    name: `module-table-${from.replace("/", "-")}`,
    severity: "error",
    comment: `src/${from}/ may import only: ${[from, ...ALLOWED[from]].join(", ")} (01-architecture.md#modules)`,
    from: { path: folderPattern(from) },
    to: { path: notAllowed.map(folderPattern) },
  };
}).filter((r) => r.to.path.length > 0);

module.exports = {
  forbidden: [
    ...forbidden,
    {
      name: "pure-layout-and-validation",
      severity: "error",
      comment: "src/layout and src/validation do no I/O (01-architecture.md#modules)",
      from: { path: "^src/(layout|validation)/" },
      to: { path: "^(node:|bun:)" },
    },
    {
      name: "pure-layout-and-validation-core",
      severity: "error",
      comment: "src/layout and src/validation import no Node core modules",
      from: { path: "^src/(layout|validation)/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    // typescript 7 has no stable compiler API for dependency-cruiser yet, so parse with swc.
    parser: "swc",
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
};
