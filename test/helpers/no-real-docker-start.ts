// Preloaded before every test file (bunfig.toml). Starting a Docker engine launches an app on the machine running
// the tests, and waits up to two minutes for it, so no test may do it: a test that wants a start injects
// `startEngine` (ToolchainOverrides) or asks for one with its own `env`. A checkout on a machine with Docker Desktop
// installed would otherwise open it mid-suite.
if (process.env.KEYLOOM_DOCKER_AUTOSTART === undefined) process.env.KEYLOOM_DOCKER_AUTOSTART = "0";
