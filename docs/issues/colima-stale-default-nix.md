# The first Glove80 build after an upgrade can read a truncated default.nix

The first v0.12.0 build of BK's Glove80 (`bld_01M50CF3YN7FJM59B2E7EBWXNS`, 2026-10-15) failed with `syntax error, unexpected end of file at /config/config/default.nix:14:75`. The file keyloom wrote was complete: `nix-instantiate --parse` in the same image accepted it, and the next build (`bld_01M50CGHGG9EHP10NMDQG7GSJM`) succeeded with the same file. keyloom had just replaced the template's shorter `default.nix` with its own, and BK's Docker runs in Colima, whose sshfs mount of `$HOME` can serve the old size for a moment, which makes the file look cut short.

Fix: write generated build files to a new name and rename them into place, so the mount sees a new file rather than a changed one, or retry once when the build's first error is a parse error in a file keyloom wrote in this run.
