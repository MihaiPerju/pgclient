import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ThemeProvider, useTheme } from "./theme";
import { ThemeSwitch } from "./ThemeSwitch";

/** The operating system's appearance, which a test can flip while the app is open. */
function operatingSystem(startsDark: boolean) {
  let dark = startsDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("prefers-color-scheme: dark") ? dark : false;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    switchTo(next: boolean) {
      dark = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

function Probe() {
  const { dark, mode } = useTheme();
  return (
    <p data-testid="probe">
      {mode} {dark ? "dark" : "light"}
    </p>
  );
}

const app = () => (
  <ThemeProvider>
    <Probe />
    <ThemeSwitch />
  </ThemeProvider>
);

/** The radio buttons of the switch are hidden behind their labels, which is what a thumb or a mouse actually hits. */
const choose = (name: string) => userEvent.click(screen.getByRole("radio", { name }).closest("label")!);

afterEach(() => document.documentElement.removeAttribute("data-theme"));

test("it follows the operating system until told otherwise, light", () => {
  operatingSystem(false);

  render(app());

  expect(screen.getByTestId("probe")).toHaveTextContent("system light");
  expect(document.documentElement.dataset.theme).toBe("light");
});

test("it follows the operating system until told otherwise, dark", () => {
  operatingSystem(true);

  render(app());

  expect(screen.getByTestId("probe")).toHaveTextContent("system dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("when the system changes at sunset, the app changes with it", () => {
  const system = operatingSystem(false);
  render(app());

  system.switchTo(true);

  expect(screen.getByTestId("probe")).toHaveTextContent("system dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("choosing dark makes it dark whatever the system says, and it is remembered", async () => {
  operatingSystem(false);
  render(app());

  await choose("Dark");

  expect(screen.getByTestId("probe")).toHaveTextContent("dark dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("pgclient.theme")).toBe("dark");
});

test("choosing light makes it light even when the system is dark", async () => {
  operatingSystem(true);
  render(app());

  await choose("Light");

  expect(screen.getByTestId("probe")).toHaveTextContent("light light");
});

test("a chosen theme is still chosen next time, and the system no longer matters", () => {
  localStorage.setItem("pgclient.theme", "light");
  const system = operatingSystem(true);

  render(app());
  system.switchTo(true);

  expect(screen.getByTestId("probe")).toHaveTextContent("light light");
});

test("going back to the system theme follows it again", async () => {
  operatingSystem(true);
  localStorage.setItem("pgclient.theme", "light");
  render(app());

  await choose("System");

  expect(screen.getByTestId("probe")).toHaveTextContent("system dark");
});

test("the switch shows which of the three is chosen", async () => {
  operatingSystem(false);
  render(app());
  expect(screen.getByRole("radio", { name: "System" })).toBeChecked();

  await choose("Dark");

  expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "System" })).not.toBeChecked();
});

test("a value left in storage that is none of the three is ignored", () => {
  localStorage.setItem("pgclient.theme", "purple");
  operatingSystem(false);

  render(app());

  expect(screen.getByTestId("probe")).toHaveTextContent("system light");
});
