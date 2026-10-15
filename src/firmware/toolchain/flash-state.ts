// What every flasher reports, so the app and the web editor treat Zapp and UF2 drives alike.
export type FlashState = "waiting_for_bootloader" | "writing" | "succeeded" | "failed";

export type FlashResult = { state: "succeeded" | "failed"; error: string | null; output: string[] };
