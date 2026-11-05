import type { CSSProperties } from "react";

/** The cross every close button in the app wears: two plain strokes with round ends, as light as the other icons, in the colour of the text round it. */
export function CloseIcon({ size = 12, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg aria-hidden focusable="false" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" style={{ flex: "none", display: "block", ...style }}>
      <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
    </svg>
  );
}

/** The same cross as a string, for the parts of the app that are drawn without React, such as the editor's search bar. */
export const CLOSE_SVG = '<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" style="display:block"><path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5"/></svg>';

/** The mark at the start of an error message: a thin ring with a bar and a dot, as light as the cross, where the library's own is a solid disc that outweighs the text beside it. */
export function ErrorIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden focusable="false" width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" style={{ flex: "none", display: "block" }}>
      <circle cx="7" cy="7" r="5.8" />
      <path d="M7 3.9V7.6" />
      <circle cx="7" cy="10.1" r="0.35" fill="currentColor" />
    </svg>
  );
}
