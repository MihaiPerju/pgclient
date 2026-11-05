/** Which columns have the text in their name, in the order they are shown. The text is looked for anywhere in the name, whatever the case, and spaces at either end of it do not count. */
export function matchingColumns(names: string[], text: string): number[] {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return [];
  return names.flatMap((name, index) => (name.toLowerCase().includes(wanted) ? [index] : []));
}

/** The match after, or before, the one that is current, going round at either end. With none current it is the first, or the last when going back. */
export function stepMatch(matches: number[], current: number | null, step: 1 | -1): number | null {
  if (matches.length === 0) return null;
  const at = current === null ? -1 : matches.indexOf(current);
  if (at < 0) return step === 1 ? matches[0] : matches[matches.length - 1];
  return matches[(at + step + matches.length) % matches.length];
}

/** Where a name is split to show which letters matched: the part before, the match, and the part after. Nothing when it does not match. */
export function splitMatch(name: string, text: string): [string, string, string] | null {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return null;
  const at = name.toLowerCase().indexOf(wanted);
  return at < 0 ? null : [name.slice(0, at), name.slice(at, at + wanted.length), name.slice(at + wanted.length)];
}

/** How far to scroll sideways for a column to be seen: centred when there is room, and no further than the ends allow. The left of the window is taken up by the row numbers, which stay where they are, so the column has to clear them. */
export function scrollLeftFor(widths: number[], column: number, view: number, counter: number, scrolled: number): number {
  const left = widths.slice(0, column).reduce((sum, width) => sum + width, 0);
  const width = widths[column] ?? 0;
  const content = widths.reduce((sum, one) => sum + one, 0);
  const room = view - counter;
  const centred = left - Math.max(0, (room - width) / 2);
  const furthest = Math.max(0, counter + content - view);
  // A column that is in view already, clear of the row numbers, stays where it is, so stepping between two near ones does not make the grid jump.
  const clearOfCounter = left >= scrolled;
  const insideView = left + width <= scrolled + room;
  if (clearOfCounter && insideView) return scrolled;
  return Math.min(furthest, Math.max(0, Math.round(centred)));
}
