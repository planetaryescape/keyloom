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
