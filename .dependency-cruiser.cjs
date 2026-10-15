// Enforces docs/blueprint/01-architecture.md "Modules". Run: bun run depcruise
// Each folder may import itself, npm packages, and the folders listed for it. src/layout and
// src/validation are pure: no node:, bun: or fs access, so the validator can run in the browser.

/** @type {Record<string, string[]>} */
const ALLOWED = {
  layout: [],
  validation: ["layout", "boards"],
  boards: ["layout"],
  "firmware/qmk": ["layout", "boards", "firmware/toolchain"],
  "firmware/zmk": ["layout", "boards", "firmware/toolchain"],
  "firmware/toolchain": [],
  agent: ["layout", "validation", "boards", "memory"],
  memory: ["layout", "persistence"],
  persistence: ["layout"],
  app: ["layout", "validation", "boards", "firmware", "agent", "memory", "persistence"],
  server: ["app"],
  cli: ["app"],
  web: ["layout"],
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
