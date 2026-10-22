// Entry point for `bun build --compile`. In a compiled Windows executable `import.meta.main` in
// main.ts is false (the bundled module path doesn't match Bun.main), so keyloom.exe ran nothing and
// exited 0. This file is only ever the entry point, so it runs the CLI unconditionally.
import { main } from "./main.ts";

await main();
