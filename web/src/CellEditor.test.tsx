import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { CellEditor, type Editing } from "./CellEditor";

const editing = (value: string | null, data_type: string, nullable = true): Editing => ({ row: 0, column: 1, value, source: { name: "doc", data_type, nullable, has_default: false } });

const open = (value: Editing) => {
  const onSave = vi.fn();
  render(<CellEditor editing={value} onSave={onSave} onClose={() => {}} />);
  return onSave;
};

test("a JSON column opens in the code editor, laid out over lines", async () => {
  open(editing('{"a":1,"b":[true,null]}', "jsonb"));

  const editor = await screen.findByRole("group", { name: "doc JSON" });
  expect(editor.textContent).toContain('"a": 1');
  expect(screen.queryByRole("textbox", { name: "doc" })).not.toBeInTheDocument();
});

test("text that only looks like JSON, in a text column, is edited as JSON too", async () => {
  open(editing('[1, 2]', "text"));

  expect(await screen.findByRole("group", { name: "doc JSON" })).toBeInTheDocument();
});

test("a json column holding nothing yet still has the JSON editor", async () => {
  open(editing(null, "json"));

  expect(await screen.findByRole("group", { name: "doc JSON" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "NULL" })).toBeChecked();
});

test("a plain value is a text box, and Save waits for a change", async () => {
  const onSave = open(editing("hello", "text"));

  expect(screen.getByRole("textbox", { name: "doc" })).toHaveValue("hello");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox", { name: "doc" }), "!");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith("hello!");
});

test("changing a value back to what it was leaves nothing to save", async () => {
  open(editing("hi", "text"));

  await userEvent.type(screen.getByRole("textbox", { name: "doc" }), "!{backspace}");

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("NULL is saved as nothing, and a value that was null is not changed by leaving it null", async () => {
  const onSave = open(editing("hello", "text"));

  await userEvent.click(screen.getByRole("checkbox", { name: "NULL" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith(null);
});

test("the value of a null cell is empty and Save waits until it is given one", async () => {
  const onSave = open(editing(null, "text"));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await userEvent.click(screen.getByRole("checkbox", { name: "NULL" }));
  await userEvent.type(screen.getByRole("textbox", { name: "doc" }), "x");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith("x");
});

test("an empty string is not null", async () => {
  const onSave = open(editing("x", "text"));

  await userEvent.clear(screen.getByRole("textbox", { name: "doc" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith("");
});

test("a column that may not be null has no NULL box", () => {
  open(editing("x", "text", false));

  expect(screen.queryByRole("checkbox", { name: "NULL" })).not.toBeInTheDocument();
  expect(screen.getByText("text · not null")).toBeInTheDocument();
});

describe("making the editor bigger or smaller", () => {
  const drag = (handle: HTMLElement, dx: number, dy: number) => {
    const fire = (type: string, x: number, y: number) => fireEvent(handle, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    fire("pointerdown", 500, 500);
    fire("pointermove", 500 + dx, 500 + dy);
    fire("pointerup", 500 + dx, 500 + dy);
  };
  const frameHeight = () => (screen.getByRole("group", { name: "doc JSON" }) as HTMLElement).style.height;

  test("a JSON editor has a grip, and dragging it changes the height of the editor", async () => {
    open(editing('{"a":1}', "jsonb"));
    const before = Number.parseInt(frameHeight());

    drag(await screen.findByRole("separator", { name: "Resize editor" }), 0, 40);

    expect(Number.parseInt(frameHeight())).toBe(before + 40);
  });

  test("the size is kept for the next time a cell is opened", async () => {
    const { unmount } = render(<CellEditor editing={editing('{"a":1}', "jsonb")} onSave={() => {}} onClose={() => {}} />);
    drag(await screen.findByRole("separator", { name: "Resize editor" }), 0, 60);
    const resized = frameHeight();
    unmount();

    render(<CellEditor editing={editing('{"b":2}', "jsonb")} onSave={() => {}} onClose={() => {}} />);

    expect(frameHeight()).toBe(resized);
  });

  test("a double click on the grip puts the editor back to its usual size", async () => {
    open(editing('{"a":1}', "jsonb"));
    const grip = await screen.findByRole("separator", { name: "Resize editor" });
    const usual = frameHeight();
    drag(grip, 0, 50);

    fireEvent.doubleClick(grip);

    expect(frameHeight()).toBe(usual);
  });

  test("a plain text value has no grip, since its box fits what is written", () => {
    open(editing("hello", "text"));

    expect(screen.queryByRole("separator", { name: "Resize editor" })).not.toBeInTheDocument();
  });
});
