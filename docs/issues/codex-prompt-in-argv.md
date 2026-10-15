# Codex gets keyloom's system prompt on its command line

`src/agent/codex/lockdown.ts:43` passes `-c developer_instructions=...` as an argument, so the prompt, which carries BK's priorities and decisions, is visible to other local users in `ps`. The run already has its own `CODEX_HOME` when `auth.json` is a file: write the instructions into that home's `config.toml` instead, and keep argv only for the keyring case.
