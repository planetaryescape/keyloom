import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { niceLayerName } from "../../layout/layer-ops.ts";
import type { ReachWords } from "../light/reach-words.ts";

interface CaptionProps {
  /** The layout picker. */
  layoutMenu: ReactNode;
  layerId: string;
  layerName: string;
  /** The layer's light as a CSS colour, or null when it is unlit. */
  light: string | null;
  /** How to reach the layer from the first one. */
  reach: ReachWords;
  /** A notice that belongs to the layout, such as the offer to read Oryx's colours into it. */
  notice?: ReactNode;
  /** A control that sits beside the layer's name, such as the phone's Left and Right. */
  aside?: ReactNode;
}

// The stage's caption (23#chrome-recedes): which layout, which layer in large type, and how to get there. The name cross-fades with the
// light when the layer changes.
export function Caption({ layoutMenu, layerId, layerName, light, reach, notice, aside }: CaptionProps) {
  const reduce = useReducedMotion() === true;
  return (
    <div className="caption">
      <div className="caption-layout">
        <span className="caption-layout-word">Layout</span>
        {layoutMenu}
      </div>
      <div className="caption-main">
      {/* popLayout takes the outgoing name out of the flow, so the two cross-fade instead of the old leaving a gap first. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={layerId}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="caption-layer">
            <span>{niceLayerName(layerName)}</span>
            <i className="caption-light" data-unlit={light === null} style={light === null ? undefined : ({ "--light": light } as CSSProperties)} aria-hidden="true" />
          </h1>
          <p className="caption-reach">
            {reach.before}
            {reach.key === null ? null : <kbd className="caption-key">{reach.key}</kbd>}
            {reach.after}
          </p>
        </motion.div>
      </AnimatePresence>
      {aside === undefined || aside === null ? null : <div className="caption-aside">{aside}</div>}
      </div>
      {notice === undefined || notice === null ? null : <div className="caption-notice">{notice}</div>}
    </div>
  );
}
