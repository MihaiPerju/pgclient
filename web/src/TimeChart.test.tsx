import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TimeChart, type Series } from "./TimeChart";

const times = [100, 105, 110, 115, 120];
const series: Series[] = [
  { key: "commits", label: "Commits", hue: "blue", values: [null, 10, 20, 30, 40] },
  { key: "rollbacks", label: "Rollbacks", hue: "orange", values: [null, 1, 0, 2, 4] },
];
const props = { title: "Transactions per second", caption: "in this database", times, series, kind: "line" as const, format: (value: number) => String(Math.round(value)) };

const chart = () => screen.getByRole("img", { name: /Transactions per second/ });

describe("a chart of how things changed", () => {
  test("it has a title, says what the numbers are, and keys every series", () => {
    render(<TimeChart {...props} />);

    expect(screen.getByText("Transactions per second")).toBeInTheDocument();
    expect(screen.getByText("in this database")).toBeInTheDocument();
    const key = screen.getByRole("list", { name: /key/ });
    expect(within(key).getByText("Commits")).toBeInTheDocument();
    expect(within(key).getByText("Rollbacks")).toBeInTheDocument();
  });

  test("a line is drawn for every series", () => {
    const { container } = render(<TimeChart {...props} />);

    expect(container.querySelectorAll("svg path")).toHaveLength(2);
  });

  test("an area chart draws a band and an edge for every series", () => {
    const { container } = render(<TimeChart {...props} kind="area" />);

    expect(container.querySelectorAll("svg path")).toHaveLength(4);
  });

  test("with fewer than two readings it says it is waiting rather than drawing nothing", () => {
    render(<TimeChart {...props} times={[100]} series={series.map((one) => ({ ...one, values: [null] }))} />);

    expect(screen.getByText("Waiting for a second reading…")).toBeInTheDocument();
    expect(chart()).toHaveAttribute("aria-label", expect.stringContaining("not enough readings"));
  });

  test("a line the values must not pass is drawn with its name", () => {
    render(<TimeChart {...props} limit={{ value: 100, label: "100 allowed" }} />);

    expect(screen.getByText("100 allowed")).toBeInTheDocument();
  });

  test("the scale reaches the limit even when the values are far below it", () => {
    render(<TimeChart {...props} limit={{ value: 100, label: "100 allowed" }} />);

    expect(screen.getByText("100")).toBeInTheDocument();
  });
});

describe("reading a moment off the chart", () => {
  test("the arrow keys step from the newest back through the readings, and every series is listed at that moment", async () => {
    render(<TimeChart {...props} />);
    chart().focus();

    fireEvent.keyDown(chart(), { key: "ArrowLeft" });

    const tip = screen.getByRole("status");
    expect(within(tip).getByText("30")).toBeInTheDocument();
    expect(within(tip).getByText("2")).toBeInTheDocument();
    expect(within(tip).getByText("Commits")).toBeInTheDocument();
    expect(within(tip).getByText("5s ago")).toBeInTheDocument();
  });

  test("it never goes past the first or the last reading", () => {
    render(<TimeChart {...props} />);

    for (let i = 0; i < 10; i++) fireEvent.keyDown(chart(), { key: "ArrowLeft" });
    expect(within(screen.getByRole("status")).getByText("20s ago")).toBeInTheDocument();
    for (let i = 0; i < 10; i++) fireEvent.keyDown(chart(), { key: "ArrowRight" });
    expect(within(screen.getByRole("status")).getByText("now")).toBeInTheDocument();
  });

  test("a missing value is a dash, not a zero", () => {
    render(<TimeChart {...props} />);

    for (let i = 0; i < 4; i++) fireEvent.keyDown(chart(), { key: "ArrowLeft" });

    expect(within(screen.getByRole("status")).getAllByText("—")).toHaveLength(2);
  });

  test("Escape and leaving the chart put the readout away", () => {
    render(<TimeChart {...props} />);
    fireEvent.keyDown(chart(), { key: "ArrowLeft" });
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.keyDown(chart(), { key: "Escape" });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("what is worked out from the values is said under them", () => {
    render(<TimeChart {...props} extra={(index) => `${index} worked out`} />);

    fireEvent.keyDown(chart(), { key: "ArrowLeft" });

    expect(within(screen.getByRole("status")).getByText("3 worked out")).toBeInTheDocument();
  });

  test("names that come from outside are shown as text and never as markup", () => {
    render(<TimeChart {...props} series={[{ key: "x", label: "<img src=x onerror=alert(1)>", hue: "blue", values: [null, 1, 2, 3, 4] }]} />);
    fireEvent.keyDown(chart(), { key: "ArrowLeft" });

    expect(document.querySelector("img")).toBeNull();
    expect(within(screen.getByRole("status")).getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});

describe("the same numbers as a table", () => {
  test("a button switches to a table with a row for every reading, newest first, and back", async () => {
    render(<TimeChart {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Table" }));

    const rows = screen.getAllByRole("row");
    expect(within(rows[0]).getByText("Commits")).toBeInTheDocument();
    expect(within(rows[1]).getByText("now")).toBeInTheDocument();
    expect(within(rows[1]).getByText("40")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Transactions per second/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Chart" }));

    expect(chart()).toBeInTheDocument();
  });

  test("a reading with no value is a dash in the table", async () => {
    render(<TimeChart {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Table" }));

    expect(within(screen.getAllByRole("row").at(-1)!).getAllByText("—").length).toBeGreaterThan(0);
  });
});
