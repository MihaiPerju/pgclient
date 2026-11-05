import { theme, type ThemeConfig } from "antd";

import type { Environment, SavedServer } from "./gateway";

/** Linear's look: near-black surfaces, cool grey text, one indigo accent, medium weights. */
export const ACCENT = "#5E6AD2";

/** The accent in each environment, standing in for the indigo everywhere it shows, so where a statement will run is seen
 * at a glance. Staging, and a server with none, keep the indigo. Keywords are the accent made readable as text. */
const ACCENTS = {
  default: { accent: ACCENT, rgb: "94, 106, 210", keyword: { dark: "#8D96F0", light: "#4C57C0" } },
  local: { accent: "#1F7A7A", rgb: "31, 122, 122", keyword: { dark: "#7CCCCB", light: "#145C5C" } },
  dev: { accent: "#1D4FC4", rgb: "29, 79, 196", keyword: { dark: "#5A87DD", light: "#1A3A9E" } },
  prod: { accent: "#A3243B", rgb: "163, 36, 59", keyword: { dark: "#D95F70", light: "#931F33" } },
};
export const FONT_SIZE = 13;
export const CONTROL_HEIGHT = 28;

const DARK = {
  layout: "#08090A",
  container: "#0F1011",
  elevated: "#17181B",
  border: "#2A2C31",
  borderSecondary: "#1E2024",
  heading: "#F7F8F8",
  text: "#D0D6E0",
  secondary: "#8A8F98",
  tertiary: "#62666D",
  fill: "rgba(255, 255, 255, 0.06)",
  fillAlter: "rgba(255, 255, 255, 0.03)",
  hover: "rgba(255, 255, 255, 0.045)",
  string: "#7FD1A0",
  number: "#E9A96B",
  comment: "#62666D",
  type: "#7DB8F0",
};

const LIGHT = {
  layout: "#F7F8F8",
  container: "#FFFFFF",
  elevated: "#FFFFFF",
  border: "#E1E2E6",
  borderSecondary: "#ECEDEF",
  heading: "#1B1C1E",
  text: "#3C4149",
  secondary: "#6B6F76",
  tertiary: "#8A8E95",
  fill: "rgba(0, 0, 0, 0.06)",
  fillAlter: "rgba(0, 0, 0, 0.025)",
  hover: "rgba(0, 0, 0, 0.04)",
  string: "#1E7F4F",
  number: "#B35C00",
  comment: "#8A8E95",
  type: "#1D6BB5",
};

export function palette(dark: boolean, environment?: Environment | null) {
  const { accent, rgb, keyword } = environment && environment !== "staging" ? ACCENTS[environment] : ACCENTS.default;
  return {
    ...(dark ? DARK : LIGHT),
    accent,
    keyword: dark ? keyword.dark : keyword.light,
    selected: `rgba(${rgb}, ${dark ? 0.2 : 0.12})`,
    selection: `rgba(${rgb}, ${dark ? 0.38 : 0.22})`,
  };
}

const FONT = '"Inter Variable", Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

/** The colours the plain parts of the page need, as variables, since a style sheet cannot ask antd for them. */
export function cssVariables(dark: boolean, environment?: Environment | null): Record<string, string> {
  const colors = palette(dark, environment);
  return {
    "--pg-layout": colors.layout,
    "--pg-container": colors.container,
    "--pg-border": colors.border,
    "--pg-border-secondary": colors.borderSecondary,
    "--pg-text": colors.text,
    "--pg-heading": colors.heading,
    "--pg-secondary": colors.secondary,
    "--pg-tertiary": colors.tertiary,
    "--pg-hover": colors.hover,
    "--pg-selection": colors.selection,
    "--pg-selected": colors.selected,
    "--pg-accent": colors.accent,
    "--pg-mono": MONO,
  };
}

export function themeFor(dark: boolean, environment?: Environment | null): ThemeConfig {
  const colors = palette(dark, environment);
  return {
    algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm],
    token: {
      colorPrimary: colors.accent,
      colorInfo: colors.accent,
      colorBgLayout: colors.layout,
      colorBgContainer: colors.container,
      colorBgElevated: colors.elevated,
      colorBorder: colors.border,
      colorBorderSecondary: colors.borderSecondary,
      colorText: colors.text,
      colorTextHeading: colors.heading,
      colorTextSecondary: colors.secondary,
      colorTextDescription: colors.secondary,
      colorTextTertiary: colors.tertiary,
      colorTextPlaceholder: colors.tertiary,
      colorFillSecondary: colors.fill,
      colorFillAlter: colors.fillAlter,
      fontFamily: FONT,
      fontFamilyCode: MONO,
      fontSize: FONT_SIZE,
      controlHeight: CONTROL_HEIGHT,
      borderRadius: 6,
      fontWeightStrong: 500,
      motionDurationMid: "0.12s",
    },
    components: {
      Button: { defaultShadow: "none", primaryShadow: "none", dangerShadow: "none", fontWeight: 500 },
      Segmented: { trackBg: colors.fillAlter, itemSelectedBg: colors.fill, itemSelectedColor: colors.heading, itemColor: colors.secondary },
      Modal: { contentBg: colors.elevated, headerBg: colors.elevated },
      Tabs: { itemColor: colors.secondary, itemHoverColor: colors.heading, itemSelectedColor: colors.heading },
    },
  };
}

/** A server's name with its environment after it, so the same database in two places never looks like one. */
export function displayName(server: Pick<SavedServer, "name" | "environment">): string {
  return server.environment ? `${server.name} – ${server.environment}` : server.name;
}
