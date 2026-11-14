import type { CSSProperties } from "react";
import type { BoardDefinition } from "../../boards/schema.ts";

type Materials = NonNullable<BoardDefinition["display"]>["materials"];

/** Physical colours are board data. Firmware lighting still uses the LED tokens. */
export function materialStyle(materials: Materials): CSSProperties {
  const style: CSSProperties & Record<`--${string}`, string> = {};
  if (materials?.case) {
    style["--case-hi"] = materials.case.light;
    style["--case-lo"] = materials.case.dark;
    style["--case-rim"] = materials.case.light;
  }
  if (materials?.caps) {
    style["--top-hi"] = materials.caps.light;
    style["--top-lo"] = materials.caps.dark;
    style["--skirt-hi"] = materials.caps.light;
    style["--skirt-lo"] = materials.caps.dark;
    style["--legend"] = materials.caps.legend;
    style["--front"] = materials.caps.legend;
    style["--ghost"] = materials.caps.legend;
  }
  if (materials?.ball) {
    style["--ball-hi"] = materials.ball.light;
    style["--ball-lo"] = materials.ball.dark;
  }
  return style;
}
