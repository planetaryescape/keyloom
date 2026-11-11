// Preloaded before every test file (bunfig.toml). Starting a Docker engine launches an app on the machine running
// the tests, and waits up to two minutes for it, so no test may do it: a test that wants a start injects
// `startEngine` (ToolchainOverrides) or asks for one with its own `env`. A checkout on a machine with Docker Desktop
// installed would otherwise open it mid-suite.
if (process.env.KEYLOOM_DOCKER_AUTOSTART === undefined) process.env.KEYLOOM_DOCKER_AUTOSTART = "0";
// Installing Docker, Zapp or a DFU tool runs `brew install` (D-488, D-489), and showing a build in Finder opens a window
// (D-490); both act on the machine running the tests. Every test injects its runner; this makes a forgotten one fail.
process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS = "1";
