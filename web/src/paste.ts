import type { Cell } from "./gateway";

/** Reads text the way a spreadsheet writes it, and the way `toTsv` writes it: a line for each row and a tab between the cells, where a cell with a tab, a line break or a quote in it is wrapped in quotes with its own quotes doubled. An empty cell is nothing, which is NULL, as in a spreadsheet. */
export function parseTsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  let started = false;

  const endCell = () => {
    row.push(cell === "" && !wasQuoted ? null : cell);
    cell = "";
    wasQuoted = false;
    started = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && !started) {
      quoted = true;
      wasQuoted = true;
      started = true;
    } else if (char === "\t") {
      endCell();
    } else if (char === "\n" || char === "\r") {
      // A line ends at a carriage return, a line feed, or both together.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else {
      cell += char;
      started = true;
    }
  }
  // What follows the last line break is not a row, but text that does not end in one still has its last row.
  if (cell !== "" || wasQuoted || row.length > 0) endRow();
  return rows;
}

/** What a paste into the grid is: rows of cells, or nothing worth adding. */
export function pastedRows(text: string): Cell[][] {
  return parseTsv(text).filter((row) => row.some((cell) => cell !== null) || row.length > 1);
}
