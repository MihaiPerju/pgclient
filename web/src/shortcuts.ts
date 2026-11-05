/** What a key press asks the window to do, if it asks for anything of the tabs and panes. */
export type Command =
  | { kind: "new-tab" }
  | { kind: "close-tab" }
  | { kind: "go-to-tab"; number: number }
  | { kind: "next-tab"; step: 1 | -1 }
  | { kind: "toggle-split" }
  | { kind: "go-to-pane"; step: 1 | -1 };

export interface Keys {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Whether the key goes to the command key of this machine: ⌘ on a Mac, Control elsewhere. */
const command = (event: Keys, mac: boolean) => (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/** Reads a key press as a command. Shortcuts are the browser's and the code editor's, so they feel known:
 * new tab, close tab, a tab by number, the next and previous tab, and split. A key the editor or the grid has for its own, such as copy, select all and run, is not here. */
export function commandFor(event: Keys, mac: boolean): Command | null {
  const key = event.key.toLowerCase();
  if (command(event, mac) && !event.altKey && !event.shiftKey) {
    if (key === "t") return { kind: "new-tab" };
    if (key === "w") return { kind: "close-tab" };
    if (key === "\\") return { kind: "toggle-split" };
    if (/^[1-9]$/.test(key)) return { kind: "go-to-tab", number: Number(key) };
  }
  // Moving between the panes is on the arrows, with Option as well, which the editor leaves alone.
  if (command(event, mac) && event.altKey && !event.shiftKey) {
    if (event.key === "ArrowLeft") return { kind: "go-to-pane", step: -1 };
    if (event.key === "ArrowRight") return { kind: "go-to-pane", step: 1 };
  }
  // Control and Tab are the browser's next tab on every system, a Mac included, where Command is for something else.
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "tab") return { kind: "next-tab", step: event.shiftKey ? -1 : 1 };
  return null;
}

/** Which tab a number goes to: the nth, and the ninth is the last however many there are, as in a browser. Nothing if there is no such tab. */
export function tabForNumber(count: number, number: number): number | null {
  if (count === 0) return null;
  if (number === 9) return count - 1;
  return number <= count ? number - 1 : null;
}

export const onMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
