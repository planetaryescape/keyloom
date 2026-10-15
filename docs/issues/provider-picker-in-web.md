# The web app can't change the provider

[19](../blueprint/19-model-providers.md#choosing-a-provider) says the web app shows the active provider and model and lets BK change them for the next conversation. Rung 10 (`413aa40`) shows them under the chat header but sets them only through `--provider`, `KEYLOOM_PROVIDER` or `<data dir>/config.json` (`src/app/agent-config.ts`). Add a picker that writes `config.json` and applies to the next conversation. Planned with rung 16's settings and states work.
