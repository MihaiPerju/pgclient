import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import type { Environment } from "./gateway";
import { MONO, palette } from "./palette";
import { searchBar } from "./searchPanel";

/** The editor in the colours of the rest of the app, so it reads as part of the page and not a box dropped into it. */
export function editorTheme(dark: boolean, environment?: Environment | null): Extension[] {
  const colors = palette(dark, environment);
  const view = EditorView.theme(
    {
      "&": { backgroundColor: "transparent", color: colors.text, fontSize: "13px", height: "100%" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: MONO, lineHeight: "1.6" },
      ".cm-content": { caretColor: colors.accent, padding: "8px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.accent, borderLeftWidth: "2px" },
      ".cm-gutters": { backgroundColor: "transparent", color: colors.tertiary, border: "none" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
      ".cm-activeLine": { backgroundColor: colors.hover },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: colors.secondary },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: colors.selection },
      ".cm-tooltip": { backgroundColor: colors.elevated, border: `1px solid ${colors.border}`, borderRadius: "6px" },
      // A match the search found, and the one the selection is on. Set here because the editor's own dark and light styles are as specific as a stylesheet is.
      ".cm-searchMatch": { backgroundColor: dark ? "rgba(237, 161, 0, 0.22)" : "rgba(237, 161, 0, 0.30)", outline: `1px solid ${dark ? "rgba(237, 161, 0, 0.45)" : "rgba(180, 120, 0, 0.5)"}` },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: colors.selection, outline: `1px solid ${colors.accent}` },
    },
    { dark },
  );
  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: colors.keyword, fontWeight: "500" },
    { tag: [tags.string, tags.special(tags.string)], color: colors.string },
    { tag: [tags.number, tags.bool, tags.null], color: colors.number },
    { tag: [tags.lineComment, tags.blockComment], color: colors.comment, fontStyle: "italic" },
    { tag: [tags.typeName, tags.standard(tags.name), tags.propertyName], color: colors.type },
  ]);
  return [view, syntaxHighlighting(highlight), searchBar];
}
