import { theme } from "antd";

import { ACCENT, CONTROL_HEIGHT, FONT_SIZE, displayName, palette, themeFor } from "./palette";

/** WCAG relative luminance and contrast ratio, so "readable" is a number and not an impression. */
const channel = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

describe.each([
  ["dark", true],
  ["light", false],
])("the %s palette", (_, dark) => {
  const colors = palette(dark);

  test("headings and body text are easy to read on the surfaces they sit on", () => {
    for (const surface of [colors.layout, colors.container, colors.elevated]) {
      expect(contrast(colors.heading, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.text, surface)).toBeGreaterThanOrEqual(7);
    }
  });

  test("secondary text, used for types and counts, still passes the standard for normal text", () => {
    for (const surface of [colors.layout, colors.container]) {
      expect(contrast(colors.secondary, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the quiet text, used for hints, is still distinguishable from the surface", () => {
    expect(contrast(colors.tertiary, colors.container)).toBeGreaterThanOrEqual(3);
  });

  test("a border can be seen against its surface, but only just", () => {
    expect(contrast(colors.border, colors.container)).toBeGreaterThan(1.15);
    expect(contrast(colors.border, colors.container)).toBeLessThan(3);
  });

  test("text steps down from heading to body, secondary and quiet", () => {
    const steps = [colors.heading, colors.text, colors.secondary, colors.tertiary].map(luminance);
    expect(new Set(steps).size).toBe(4);
    expect(steps).toEqual([...steps].sort((a, b) => (dark ? b - a : a - b)));
  });
});

test("dark is near black with each layer a step lighter, and light is off-white with white layers", () => {
  const night = palette(true);
  expect(luminance(night.layout)).toBeLessThan(luminance(night.container));
  expect(luminance(night.container)).toBeLessThan(luminance(night.elevated));
  expect(luminance(night.layout)).toBeLessThan(0.01);
  const day = palette(false);
  expect(day.container).toBe("#FFFFFF");
  expect(luminance(day.layout)).toBeGreaterThan(0.9);
});

test("white text on the accent, as on the Run button, is readable in both themes", () => {
  expect(contrast("#FFFFFF", ACCENT)).toBeGreaterThanOrEqual(4.5);
});

test("both themes share the one accent and the one compact size, which is what makes it feel like one app", () => {
  for (const dark of [true, false]) {
    const config = themeFor(dark);
    expect(config.token).toMatchObject({ colorPrimary: ACCENT, fontSize: FONT_SIZE, controlHeight: CONTROL_HEIGHT });
  }
  expect(FONT_SIZE).toBeLessThanOrEqual(13);
});

test("the dark theme uses antd's dark algorithm with the compact one on top, and the light theme the default", () => {
  expect(themeFor(true).algorithm).toEqual([theme.darkAlgorithm, theme.compactAlgorithm]);
  expect(themeFor(false).algorithm).toEqual([theme.defaultAlgorithm, theme.compactAlgorithm]);
});

describe.each([
  ["dark", true],
  ["light", false],
])("the environment accents in %s", (_, dark) => {
  test.each(["local", "dev", "prod"] as const)("%s keeps keywords readable and white text on its buttons", (environment) => {
    const colors = palette(dark, environment);
    expect(contrast(colors.keyword, colors.container)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accent, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  test("staging and no environment keep the indigo", () => {
    expect(palette(dark, "staging")).toEqual(palette(dark));
    expect(palette(dark, null).accent).toBe(ACCENT);
  });

  test("every indigo moves with the environment: the accent, keywords, selection and the selected rows", () => {
    const indigo = palette(dark);
    const prod = palette(dark, "prod");
    for (const key of ["accent", "keyword", "selection", "selected"] as const) expect(prod[key]).not.toBe(indigo[key]);
    expect(themeFor(dark, "prod").token?.colorPrimary).toBe(prod.accent);
  });

  test("each environment has its own", () => {
    expect(new Set(["local", "dev", "prod"].map((environment) => palette(dark, environment as "local").accent)).size).toBe(3);
  });
});

test("the environment follows the name, and a server without one is shown as it is", () => {
  expect(displayName({ name: "shop", environment: "dev" })).toBe("shop – dev");
  expect(displayName({ name: "shop", environment: null })).toBe("shop");
});
