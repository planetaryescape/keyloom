// Bun embeds files imported with `with { type: "file" }` and gives back a path-like string.
declare module "*.wasm" {
  const path: string;
  export default path;
}
declare module "*.sql" {
  const text: string;
  export default text;
}
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*Dockerfile" {
  const text: string;
  export default text;
}
// keyloom's ZMK module, embedded as text (src/firmware/zmk/module.ts).
declare module "*.txt" {
  const text: string;
  export default text;
}
declare module "*/Kconfig" {
  const text: string;
  export default text;
}
declare module "*.overlay" {
  const text: string;
  export default text;
}
declare module "*.c" {
  const text: string;
  export default text;
}
declare module "*.yml" {
  const text: string;
  export default text;
}
