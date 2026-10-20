// The release builder replaces this module with a static binary-asset import and its manifest.
// Source invocation never searches PATH, the working directory, or a developer's target directory.
type PackagedHelper = { manifest: unknown; asset: string };
export const packagedHelper: PackagedHelper | undefined = undefined;
