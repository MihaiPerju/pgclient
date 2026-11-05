import { startCompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef, type MouseEvent } from "react";

import { editorTheme } from "./editorTheme";
import type { CatalogTable, Environment } from "./gateway";
import { sqlSuggestions } from "./suggest";

interface Props {
  value: string;
  dark: boolean;
  /** Where the statements run, which sets the accent. */
  environment?: Environment | null;
  /** The database's tables, columns and foreign keys, suggested while typing. */
  catalog?: CatalogTable[] | null;
  /** Called with the text as well as what is selected in it, so Run can do just the selection. */
  onChange: (value: string, selection: string) => void;
  onRun: () => void;
  /** Asks how the statement would run, or with `analyze` runs it to see. */
  onExplain?: (analyze: boolean) => void;
}

/** What is written just before the cursor when a table name, or a join's condition, comes next. */
const TABLE_NEXT = /\b(from|join|on)\s$/i;

/** Typing the space after `from`, `join` or `on` opens the list, which otherwise waits for the first letter. */
const tablesAfterFrom = EditorView.updateListener.of((update) => {
  if (!update.transactions.some((transaction) => transaction.isUserEvent("input.type"))) return;
  const { head } = update.state.selection.main;
  if (!TABLE_NEXT.test(update.state.sliceDoc(Math.max(0, head - 6), head))) return;
  // The editor cannot be changed from inside one of its own updates, so the list opens just after.
  setTimeout(() => startCompletion(update.view));
});

export function SqlEditor({ value, dark, environment, catalog, onChange, onRun, onExplain }: Props) {
  const view = useRef<EditorView | null>(null);
  const run = useRef(onRun);
  run.current = onRun;
  const explain = useRef(onExplain);
  explain.current = onExplain;
  const extensions = useMemo(
    () => [
      ...sqlSuggestions(catalog),
      tablesAfterFrom,
      ...editorTheme(dark, environment),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              run.current();
              return true;
            },
          },
          {
            key: "Mod-e",
            run: () => {
              explain.current?.(false);
              return true;
            },
          },
          {
            key: "Shift-Mod-e",
            run: () => {
              explain.current?.(true);
              return true;
            },
          },
        ]),
      ),
    ],
    [dark, environment, catalog],
  );

  /** The editor only listens to clicks on its text, which is as tall as what is written. A click anywhere else in the pane
   * still means "I want to type here", so it focuses the editor and puts the cursor after the last character. */
  function focusEditor(event: MouseEvent<HTMLDivElement>) {
    const editor = view.current;
    if (
      !editor ||
      (event.target as HTMLElement).closest(".cm-content, .cm-gutters")
    )
      return;
    event.preventDefault();
    editor.focus();
    editor.dispatch({
      selection: { anchor: editor.state.doc.length },
      scrollIntoView: true,
    });
  }

  return (
    <div style={{ height: "100%" }} onMouseDown={focusEditor}>
      <CodeMirror
        value={value}
        height="100%"
        style={{ height: "100%" }}
        theme="none"
        extensions={extensions}
        basicSetup={{ foldGutter: false, highlightActiveLine: true }}
        aria-label="SQL"
        onChange={(text, update) => {
          const { from, to } = update.state.selection.main;
          onChange(text, update.state.sliceDoc(from, to));
        }}
        onUpdate={(update) => {
          if (!update.selectionSet) return;
          const { from, to } = update.state.selection.main;
          onChange(
            update.state.doc.toString(),
            update.state.sliceDoc(from, to),
          );
        }}
        onCreateEditor={(created) => {
          view.current = created;
        }}
      />
    </div>
  );
}
