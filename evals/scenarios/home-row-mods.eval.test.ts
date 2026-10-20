// Paid generation is opt-in through provider.ts: KEYLOOM_LIVE_EVALS=1 plus a provider credential.
import { test } from "bun:test";
import { live } from "../provider.ts";
import { homeRowModsPasses } from "../vocabulary-oracles.ts";
import { runVocabularyScenario } from "../vocabulary-scenario.ts";

test.skipIf(!live)("eval: F and J keep their letters and hold Command with opposite-hand protection or a warning", async () => {
  await runVocabularyScenario("home-row-mods",
    "On Base, make F and J home-row mods: tap F or J as before, hold either for Left Command (LGUI only, including J). Use opposite-hand hold-trigger positions for each hand to avoid same-hand rolls, or surface the home-row-mod warning if you leave that protection off. Propose now.",
    homeRowModsPasses);
}, 900_000);
