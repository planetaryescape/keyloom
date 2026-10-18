# 23: Design concept: the keyboard under the light

Status: adopted, 2026-10-16 (D-260). BK approved the comps: "Yes, build it". This chapter replaces the rules in [18](18-visual-design.md) that it contradicts; each replacement is a decision in [14](14-decision-log.md) (D-260 to D-269). Behaviour stays in the domain chapters ([16](16-key-editor.md), [17](17-keyboard-sync.md), [20](20-cross-board.md), [21](21-macbook-keyboard.md), [22](22-new-keyboard.md)); this says how it should be experienced.

Why it exists: BK judged the v0.19 UI twice. "It looks like a weekend project, it lacks polish, it doens't look like something that had a design team." Then: "It just feels busy", and "it's like if you describe functionality and someone just makes a thing that does exactly what you asked behaviourally and no more". The comps that this chapter adopts are in `.orchestrate/keyloom-2026-10-15/evidence/concept/` (concept.md, a-k HTML comps, shots/, motion/).

## What this is to the person

A programmable keyboard is a physical thing BK touches all day, and he knows each of his by shape: "the moonlander kinda has an iconic desing, the red thumb cluster button". He owns a ZSA Moonlander, a MoErgo Glove80 and a Corne, and types on a MacBook. He comes to keyloom to change what one of them does, by hand or by asking, and to be sure the change is on the keyboard in his hands. He loves Oryx for how few steps a change takes and Vial for changes that land without a bootloader.

## The concept

**The keyboard under the light.** Each board is drawn as itself (its case, its sculpted caps, the Moonlander's red thumb keys, the Glove80's wells and thumb fans, a MacBook's black keys in aluminium) and sits alone on a seamless backdrop with a contact shadow, like a product photograph. Everything else recedes into quiet ink and grey. Light carries meaning, because these keyboards already use light to say which layer is on: each layer has one colour, shown as the board's underglow and as the dot on keys that reach it; per-key LEDs bleed under the caps; amber means a change isn't on the keyboard yet, green that it is. A change you apply is a key you press.

It fits keyloom and not any app: the product is a configurator for an object, and the object, lit, is the interface.

## How the whole fits together

### The mental model

Four nouns, and no others on any surface:

| Noun | What it is | How it shows |
|---|---|---|
| Board | A keyboard the person owns | Itself on the stage; its silhouette in the top bar |
| Layer | A full set of what every key does | Its light: the underglow, the status, the dot on keys that reach it |
| Key | One position, with up to four actions | A keycap: tap on the top face, hold printed on the front |
| Change | A difference between keyloom and the keyboard | Amber until it is on the keyboard; green when it is |

Firmware names, positions and revision IDs stay behind Advanced view.

### The map

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ keyloom [▣ Moonlander ▣ ▣ ▣]     ● On your Moonlander      [Ask keyloom ⌘K] ↶ ☾ ⋯ │  always
├───────────────────────────────────────────────────────────────┬───────────────────┤
│ Layout synchronized ▾                                          │                   │
│ Symbols ●                                                      │  sheet, one at a  │
│ Hold ⇥ on the left thumb                                       │  time: the key,   │
│                    ┌──────────┐      ┌──────────┐              │  the chat,        │
│                    │  board   │      │  board   │   the stage  │  History, Library,│
│                    └──────┬───┘      └───┬──────┘              │  Combos, Settings │
│                         thumbs         thumbs                  │  (opens on top,   │
│        [Base][Sym][Nav][Mouse][Colemak][Game] +   ◎ Inspect     │   Esc closes)     │
└───────────────────────────────────────────────────────────────┴───────────────────┘
```

- **Always there:** the top bar (boards, the sync line, Ask keyloom, undo, the menu), the stage with the board and its caption, and the layer strip.
- **Opens on top, one at a time:** the key card (P2: between the parted halves; P1: the sheet), Ask keyloom (P3: the command bar; P1: the sheet), and a sheet from the right for History, Library, Combos or Settings. Opening one closes another. The board moves aside for a sheet and never sits under one.
  - D-410 reasserts this for the board review, proposals and lab too: choosing Settings while Hints is open replaces Hints, not a second panel behind it. A hidden conversation can retain its request/history, but active work keeps a visible Stop control. Closing the new sidebar does not reveal the old one.
- **Comes to you:** a board that connects (a card on the stage), a keyboard that falls behind (the sync line turns amber), a failure (the sync line turns red and opens to say what to do).
- **Getting back:** Esc closes one thing at a time, down to the plain stage. The stage is home.

### The journeys, end to end

1. **Tell it what I want.** ⌘K from anywhere; selected keys and the layer on screen carry into the question. The proposal is drawn on the caps it touches in amber; alternatives redraw it. Apply presses the changed keys down; the sync line goes amber ("Sending to your Moonlander…") and then green. The reason is kept against those keys.
2. **Change a key by hand.** Click it, or press it on the real keyboard and it lights on screen. The card shows the key as a big cap. Pick a hold: the board shows the draft in amber, Apply says what it will do. Enter presses the key and the light runs to the sync line.
3. **Switch boards.** Click a silhouette. The new board replaces the old on the stage with its own case and layers. The ⌘K thread stays; the sync line now speaks about the new board.
4. **A new board appears.** A card on the stage offers to put a layout on it; the fit is previewed like any proposal; nothing is sent before Apply ([22](22-new-keyboard.md)).

### Shared patterns

- **One picker** for every slot, macro step and combo output.
- **One confirm:** Apply, with the change said in words, shown only when something changed.
- **One undo:** ⌘Z or the arrow in the top bar; every change is one step, whoever made it.
- **One "this changed" signal:** amber. A dot and a halo on the cap, an amber sync light. Nothing else is amber.
- **One place for errors:** the sync line, and toasts that rise above the strip for a change that couldn't be made.

### Across surfaces

The web app, the CLI and the agent use the four nouns and the same state sentences: "On your Moonlander", "2 changes not on your Moonlander", "Needs a hand" ([17](17-keyboard-sync.md)). The sync sentences already come from one module (`src/web/sync/words.ts`).

### The system's own state

Always visible without asking: which board and layout, which layer and how to reach it, whether the keyboard has the latest change (the sync line's light), and whether something is a draft (amber on the cap).

## Principles

1. **The board is the only hero.** One object on a backdrop; chrome is ink and grey and must earn its place.
2. **Calm by default, detail on request.** A cap shows what a real dual-legend cap shows. Kinds, inherited legends, combos and firmware names wait behind Inspect and Advanced view.
3. **Light means one thing per colour.** A layer's colour, amber for not-yet-on-the-keyboard, green for on it. Colour is never decoration.
4. **Keys never move when the meaning changes.** A layer switch changes the legends and the light, not the geometry.
5. **Edit on the key.** The card's hero is the key itself (P2).
6. **Physical feedback.** Applying presses the key down.
7. **Every board is drawn from data.** A contributed board gets its case, caps and silhouette with no code of its own. A board someone owns can be drawn from photographs of it instead, still as data (D-277).

## Key moments

| Moment | What the person should feel | What makes it land |
|---|---|---|
| First open | "That's my keyboard" | The board as itself, lit, centred; one hint line |
| Switching layer | "I'm on a different layer now" | The underglow changes first, then legends and LEDs change in a ripple from the thumb that holds the layer |
| Finding a key | "There it is" | Press it on the real keyboard and it lights on screen |
| Applying | "Done, and it's on the keyboard" | The key presses down; the sync light goes amber, then green |
| Waiting | Calm | The sync light breathes; nothing else moves |
| Failure | "I know what to do" | The sync line turns red and opens to the reason and the action |

## Visual language

- **Type:** one family, Instrument Sans, with its width axis (75 to 100), so long legends get narrower instead of smaller (D-261). Sizes: 44 layer title, 28 phone title, 16 brand, 14 body, 13 chrome, 11 the legend floor. Cap legends step down with length (0.28u for a glyph to 0.18u for a word) at about 480 weight, and words are set at 75% width (D-271). Weights 450 to 600.
- **Legends:** words a person reads, never firmware spelling (D-270): `!` not ⇧1, Vol+ not VOLU, "Navigate / go to" not "NAV / go", "F5 / Game" for an Oryx dual-function key. Firmware names live behind Advanced view.
- **Colour:** tokens in `src/web/tokens.css`. The theme is the room: dark `#0e0f12` with a `#1d1f24` spot, light `#e4e5e8` with `#f8f8f9`. Ink in three steps. The board's colourway follows the room: black caps in the dark, white in the light (D-262), unless BK pins it to his board's colourway (D-395). Amber `--pending`, green `--ok`, red `--bad`. Six layer colours (`--layer-1` to `--layer-6`) light layers with no LEDs of their own.
- **Materials:** the keycap is five layers (bleed, skirt, LED tint, dished face, legends), every size a multiple of `--u`. Cases are filled outlines with a soft drop shadow. Cards are surfaces with a large soft shadow and no border.
- **Icons:** lucide, at 15 to 18 px, in ink. No emoji.
- **Density:** the board has the stage; the caption, the strip and the top bar take the edges.

## Motion

| What | How | Why |
|---|---|---|
| Layer change | Underglow crossfade 0.5 s; legends out 90 ms and in 170 ms, delayed 18 ms per key unit from the holding key | Shows where the layer comes from; keys stay put |
| LED change | Bleed and skirt tint transition 0.35 s with the same delay | The light moves with the legends |
| Layer name | Crossfade and a 4 px rise, 0.2 s (Motion) | The title follows the light |
| Apply | The cap travels down 0.08 u past rest and springs back, 0.42 s (Motion) | A switch press |
| Found key | An ink ring that fades over 1.4 s | Draws the eye, then gets out of the way |
| Busy sync | The light breathes, 1.4 s | Waiting without words |

`prefers-reduced-motion` turns all of it off and keeps every state: legends switch at once and the old one is never drawn.

## Hierarchy and restraint

- **Primary:** the board and its light.
- **Secondary:** the layer's name and how to reach it; the strip; the sync line.
- **Hidden until asked:** key kinds in three hues, inherited legends, combo lines (Inspect, ⌥I); firmware names (Advanced view); History, Library, Combos, Settings, Build and flash, shortcuts, theme choice (the menu); selection actions (only once keys are selected).
- **Left off on purpose:** the permanent side panel and its layout summary (the board says it), the toolbar row (each item opens rarely), kind fills at rest (colour carried nothing and made the board a chart), trays (a tray says widget, a case says keyboard), the bottom chat bar (chat is an action, not a strip), the instruction rows.

## Taste references

- **Oryx:** few steps per change and the popover on the key. We take the popover; we don't take the always-on kind colours or the page chrome.
- **Vial:** changes that land without ceremony. We take the immediacy of the sync light.
- **Apple's product photography:** the object alone on a sweep, lit from above. We take the stage and the contact shadow.

## Screens

The comps are the screens: `a-moonlander-idle` (rest), `b-edit-key` and `b2-key-card-states` (P2), `c-layer-light` (a lit layer), `d-command-bar` (P3), `e-glove80-idle`, `f-phone-edit-key`, `h-how-it-fits-together` (the storyboard), `j-macbook-sketch`, `k-new-board`. At rest the eye lands on the board, then the layer's name; nothing else competes.

## The design gate

A phase is done when:

1. it was built to the comps, and any state the comps don't cover is designed in these terms, not only made to work;
2. every changed screen is screenshot at 1440×900 and 390×844, light and dark, read, and compared side by side with its comp;
3. the key moments it touches are checked by using them on the served app (a recording for motion);
4. the journeys it touches are walked end to end;
5. `test/web/contrast.test.ts` and `test/web/led-contrast.test.ts` pass for the new tokens;
6. a design review is run against this chapter.

## Build phases

| Phase | What lands | Status |
|---|---|---|
| P1 | The board renderer for every board, the room, the light, front-printed legends, Inspect, the top bar and sync line, the layer strip, the ripple, the press, the tokens and type | Built (rung "light", D-260 to D-273, after the first design review) |
| P2 | The key card: the lit keycap as hero, slot regions, inline picker, the board slides only when needed | Built (D-275, D-276) |
| P3 | ⌘K as the command bar, proposals on the caps | Built (D-278, D-279, D-310, D-311) |
| P4 | History, Library, Settings, Combos, import and new board, sync detail, MacBook states | Built (D-312), except the new-board stage card, which is rung 21's ([22](22-new-keyboard.md)) |
| P5 | Phones for all of it, and a full light and dark pass | Built (D-313); the typing lab, configs and journeys after it kept the same gate (D-314 to D-317) |
