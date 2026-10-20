// Paid generation is opt-in through provider.ts: KEYLOOM_LIVE_EVALS=1 plus a provider credential.
import { test } from "bun:test";
import { live } from "../provider.ts";
import { numberLayerPasses } from "../vocabulary-oracles.ts";
import { runVocabularyScenario } from "../vocabulary-scenario.ts";

test.skipIf(!live)("eval: number layer puts digits on home and shifted symbols above, reachable from Base", async () => {
  await runVocabularyScenario("number-layer",
    "Add a reachable number layer: 1 2 3 4 5 under A S D F G and 6 7 8 9 0 under H J K L semicolon. Put ! @ # $ % above the left digits and ^ & * ( ) above the right digits, using Shift plus those numbers. Leave Base letters intact; use an unused thumb key to hold the layer. Propose now.",
    numberLayerPasses);
}, 900_000);
