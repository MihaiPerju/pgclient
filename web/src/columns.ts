export const DEFAULT_WIDTH = 180;
export const MIN_WIDTH = 60;
/** What fitting a column to its contents will give, so one huge value does not make a column wider than the screen. */
export const MAX_WIDTH = 600;
/** What a column can be dragged to. */
export const MAX_DRAG_WIDTH = 2000;

const CHAR_WIDTH = 7.3;
const PADDING = 28;
const SAMPLE = 200;
const NULL_WIDTH = "NULL".length;

/** Wide enough for the longest of the first few hundred values and the name at the top, the way a spreadsheet fits a column. */
export function fitWidth(name: string, values: (string | null)[]): number {
  const longest = values.slice(0, SAMPLE).reduce((most, value) => Math.max(most, value === null ? NULL_WIDTH : value.length), name.length);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(longest * CHAR_WIDTH) + PADDING));
}
