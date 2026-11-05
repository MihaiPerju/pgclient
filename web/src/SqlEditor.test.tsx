import { completionStatus } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { SqlEditor } from "./SqlEditor";

function setup(value = "select 1") {
  const view = render(
    <div data-testid="pane" style={{ height: 400 }}>
      <SqlEditor value={value} dark={false} onChange={vi.fn()} onRun={vi.fn()} />
    </div>,
  );
  const editor = () => EditorView.findFromDOM(view.container.querySelector(".cm-editor") as HTMLElement)!;
  const content = () => view.container.querySelector(".cm-content") as HTMLElement;
  return { ...view, editor, content };
}

describe("clicking in the editor", () => {
  test("anywhere in the pane, such as the empty space below the text, puts the cursor in the editor", () => {
    const { container, content } = setup();
    expect(document.activeElement).not.toBe(content());

    fireEvent.mouseDown(container.querySelector(".cm-scroller") as HTMLElement);

    expect(document.activeElement).toBe(content());
  });

  test("the cursor goes to the end of what is written, so typing carries on from there", () => {
    const { container, editor } = setup("select 1");

    fireEvent.mouseDown(container.querySelector(".cm-scroller") as HTMLElement);

    expect(editor().state.selection.main.head).toBe("select 1".length);
  });

  test("the same goes for the pane around the editor, wherever it does not reach", () => {
    const { getByTestId, container, editor, content } = setup("select 1");

    fireEvent.mouseDown(container.querySelector(".cm-editor") as HTMLElement);

    expect(document.activeElement).toBe(content());
    expect(editor().state.selection.main.head).toBe("select 1".length);
    expect(getByTestId("pane")).toBeInTheDocument();
  });

  /** The cursor moves this component makes ask for the cursor to be scrolled into view, which the editor's own handling of a click does not. */
  const ourMoves = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([spec]) => (spec as { scrollIntoView?: boolean } | undefined)?.scrollIntoView === true);

  test("a click on the text itself is left to the editor, which puts the cursor where it was clicked", () => {
    const { content, editor } = setup("select 1");
    const dispatch = vi.spyOn(editor(), "dispatch");

    fireEvent.mouseDown(content());

    expect(ourMoves(dispatch)).toHaveLength(0);
  });

  test("a click on the line numbers is left to the editor too", () => {
    const { container, editor } = setup("select 1");
    const dispatch = vi.spyOn(editor(), "dispatch");

    fireEvent.mouseDown(container.querySelector(".cm-gutters") as HTMLElement);

    expect(ourMoves(dispatch)).toHaveLength(0);
  });

  test("a click anywhere else does make that move", () => {
    const { container, editor } = setup("select 1");
    const dispatch = vi.spyOn(editor(), "dispatch");

    fireEvent.mouseDown(container.querySelector(".cm-scroller") as HTMLElement);

    expect(ourMoves(dispatch)).toHaveLength(1);
  });

  test("it works in an editor with nothing written in it yet", () => {
    const { container, content, editor } = setup("");

    fireEvent.mouseDown(container.querySelector(".cm-scroller") as HTMLElement);

    expect(document.activeElement).toBe(content());
    expect(editor().state.selection.main.head).toBe(0);
  });
});

describe("suggestions", () => {
  const type = (editor: EditorView, text: string) => {
    const at = editor.state.doc.length;
    editor.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" });
  };

  test.each(["select * from", "select * from orders o join", "select * from orders o\nleft JOIN"])("typing the space after %j opens the list of tables", async (before) => {
    const { editor } = setup(before);

    type(editor(), " ");

    await waitFor(() => expect(completionStatus(editor().state)).not.toBeNull());
  });

  test("a space anywhere else leaves the list closed", async () => {
    const { editor } = setup("select");

    type(editor(), " ");
    // Longer than the editor's own wait before it looks for suggestions as you type.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(completionStatus(editor().state)).toBeNull();
  });
});

describe("keys", () => {
  test("⌘E explains the statement, and ⇧⌘E explains it by running it", () => {
    const onExplain = vi.fn();
    const { container } = render(<SqlEditor value="select 1" dark={false} onChange={vi.fn()} onRun={vi.fn()} onExplain={onExplain} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "e", code: "KeyE", keyCode: 69, ctrlKey: true });
    fireEvent.keyDown(content, { key: "E", code: "KeyE", keyCode: 69, ctrlKey: true, shiftKey: true });

    expect(onExplain.mock.calls).toEqual([[false], [true]]);
  });
});
