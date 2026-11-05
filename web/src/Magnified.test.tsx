import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Magnified, MagnifyButton } from "./Magnified";

function setup() {
  render(
    <Magnified label="Results">
      {(magnify) => (
        <div role="region" aria-label="Surface">
          <MagnifyButton magnify={magnify} />
          <input aria-label="Cell" onKeyDown={(event) => event.key === "Escape" && event.target instanceof HTMLInputElement && event.target.dataset.handles === "yes" && event.preventDefault()} />
        </div>
      )}
    </Magnified>,
  );
  return { user: userEvent.setup(), surface: screen.getByRole("region", { name: "Surface" }) };
}

const big = () => screen.queryByRole("dialog", { name: "Results" });

test("the button grows it to fill the window, and Escape or the button puts it back", async () => {
  const { user } = setup();
  const button = screen.getByRole("button", { name: "Full screen" });

  await user.click(button);
  expect(big()).toBeInTheDocument();
  expect(button).toHaveAttribute("aria-pressed", "true");

  await user.keyboard("{Escape}");
  await waitFor(() => expect(big()).not.toBeInTheDocument());

  await user.click(button);
  await user.click(button);
  await waitFor(() => expect(big()).not.toBeInTheDocument());
});

test("a pinch grows it and it stays where the fingers stop; a small one puts it back", async () => {
  const { surface } = setup();

  fireEvent.wheel(surface, { ctrlKey: true, deltaY: -20 });
  const dialog = big();
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(big()).toBe(dialog);
  expect(screen.getByRole("button", { name: "Full screen" })).toHaveAttribute("aria-pressed", "false");

  fireEvent.wheel(surface, { ctrlKey: true, deltaY: 30 });
  await waitFor(() => expect(big()).not.toBeInTheDocument());
});

test("a scroll without the control key is left to what is in it", () => {
  const { surface } = setup();

  fireEvent.wheel(surface, { deltaY: -200 });

  expect(big()).not.toBeInTheDocument();
});

test("Escape typed in a field, or already used by what is in it, does not put it back", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Full screen" }));
  const cell = screen.getByRole("textbox", { name: "Cell" });

  await user.click(cell);
  await user.keyboard("{Escape}");
  cell.dataset.handles = "yes";
  fireEvent.keyDown(cell, { key: "Escape" });
  await new Promise((resolve) => setTimeout(resolve, 300));

  expect(big()).toBeInTheDocument();
});

test("it grows beneath the dialogs opened from what is in it, such as a cell's editor", async () => {
  const { user } = setup();

  await user.click(screen.getByRole("button", { name: "Full screen" }));

  expect(Number(big()!.style.zIndex)).toBeLessThan(1000);
});
