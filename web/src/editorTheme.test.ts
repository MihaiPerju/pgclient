import { sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { editorTheme } from "./editorTheme";
import type { Environment } from "./gateway";
import { palette } from "./palette";

function styles(dark: boolean, environment?: Environment): string {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ state: EditorState.create({ doc: "select 1 from t -- note", extensions: [sql(), ...editorTheme(dark, environment)] }), parent });
  const css = [...document.querySelectorAll("style")].map((element) => element.textContent).join("\n").toLowerCase();
  view.destroy();
  parent.remove();
  return css;
}

test("the editor takes its colours from the palette: keywords, strings and the selection", () => {
  const css = styles(true);

  expect(css).toContain(palette(true).keyword.toLowerCase());
  expect(css).toContain(palette(true).string.toLowerCase());
  expect(css).toContain(palette(true).selection.replaceAll(" ", "").toLowerCase().replaceAll("rgba(", "rgba(").slice(0, 8));
});

test("light and dark are different themes, not one theme with a switch flipped", () => {
  const dark = editorTheme(true);
  const light = editorTheme(false);

  expect(dark).toHaveLength(light.length);
  expect(styles(false)).toContain(palette(false).keyword.toLowerCase());
});

test("in prod the keywords and the cursor take the prod accent, and in staging they stay indigo", () => {
  const css = styles(true, "prod");
  expect(css).toContain(palette(true, "prod").keyword.toLowerCase());
  expect(css).toContain(palette(true, "prod").accent.toLowerCase());
  expect(styles(false, "staging")).toContain(palette(false).keyword.toLowerCase());
});
