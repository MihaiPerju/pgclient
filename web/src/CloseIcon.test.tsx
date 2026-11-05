import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alert, Input, Modal } from "antd";

import { CLOSE_SVG, CloseIcon, ErrorIcon } from "./CloseIcon";
import { ThemeProvider } from "./theme";

const strokeOf = (element: Element | null) => element?.querySelector("svg")?.getAttribute("stroke");

describe("the cross every close button wears", () => {
  test("it is drawn in the colour of the text round it, and is hidden from a screen reader since the button has the name", () => {
    const { container } = render(<CloseIcon />);

    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  test("it can be any size", () => {
    const { container } = render(<CloseIcon size={20} />);

    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
  });

  test("the version for the parts drawn without React is the same drawing", () => {
    const { container } = render(<CloseIcon />);
    const holder = document.createElement("div");
    holder.innerHTML = CLOSE_SVG;

    expect(holder.querySelector("path")?.getAttribute("d")).toBe(container.querySelector("path")?.getAttribute("d"));
    expect(holder.querySelector("svg")?.getAttribute("stroke-width")).toBe(container.querySelector("svg")?.getAttribute("stroke-width"));
  });

  test("the error mark is as light as the cross, and takes the colour of what it sits in", () => {
    const { container } = render(<ErrorIcon />);

    expect(container.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("every close button in the app wears it, however the library draws its own", () => {
  test("a modal's", async () => {
    render(
      <ThemeProvider>
        <Modal open title="x" onCancel={() => {}}>
          body
        </Modal>
      </ThemeProvider>,
    );

    expect(strokeOf(await screen.findByRole("button", { name: "Close" }))).toBe("currentColor");
  });

  test("an alert's, with the error mark at its start", () => {
    const { container } = render(
      <ThemeProvider>
        <Alert type="error" showIcon closable={{ "aria-label": "Close" }} title="boom" />
      </ThemeProvider>,
    );

    expect(strokeOf(within(container).getByRole("button", { name: "Close" }))).toBe("currentColor");
    expect(container.querySelector(".ant-alert-icon svg circle")).not.toBeNull();
  });

  test("an alert's is named, so a screen reader does not say 'button' and nothing else", () => {
    render(
      <ThemeProvider>
        <Alert type="error" closable={{ "aria-label": "Close" }} title="boom" />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  test("a search box's clear button", async () => {
    const { container } = render(<Input allowClear={{ clearIcon: <CloseIcon size={10} /> }} defaultValue="abc" />);
    await userEvent.hover(container.querySelector("input")!);

    expect(container.querySelector(".ant-input-clear-icon svg")).toHaveAttribute("stroke", "currentColor");
  });
});
