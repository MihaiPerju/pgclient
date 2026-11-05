import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, SearchQuery, setSearchQuery } from "@codemirror/search";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

import { CLOSE_SVG } from "./CloseIcon";

/** The most matches that are counted. Counting every one in a huge document on each keystroke would be work for nothing, and "1000+" says all there is to say. */
export const COUNT_LIMIT = 1000;

export interface Matches {
  /** How many there are, up to the limit. */
  total: number;
  /** Whether there are more than that. */
  more: boolean;
  /** Which one the selection is on, counting from one, or 0 when it is on none of them. */
  current: number;
}

/** Counts the matches of a query in the document, and finds which one the cursor is on. */
export function matchesIn(state: EditorState, query: SearchQuery): Matches {
  if (!query.valid) return { total: 0, more: false, current: 0 };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (total === COUNT_LIMIT) return { total, more: true, current };
    total += 1;
    if (next.value.from === from && next.value.to === to) current = total;
  }
  return { total, more: false, current };
}

/** What the count says: which match of how many, or that there is none, or nothing while nothing has been typed. */
export function describe(matches: Matches, query: SearchQuery): string {
  if (query.search === "") return "";
  if (!query.valid) return "Not a valid expression";
  if (matches.total === 0) return "No results";
  const total = `${matches.total}${matches.more ? "+" : ""}`;
  return matches.current > 0 ? `${matches.current} of ${total}` : `${total} found`;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
  made.append(...children);
  return made;
};

function button(label: string, title: string, run: () => void, extra: Record<string, string> = {}) {
  const made = element("button", { type: "button", class: "pg-find-button", "aria-label": title, title, ...extra }, label);
  if (extra["data-icon"] === "close") made.innerHTML = CLOSE_SVG;
  made.addEventListener("click", run);
  return made;
}

/** A search bar of the app's own, in place of the one the library draws: along the top, with the count of matches, the options as buttons that can be seen to be on, and Replace out of the way until it is wanted. */
function createPanel(view: EditorView): Panel {
  const input = element("input", { class: "pg-find-input", placeholder: "Find", "aria-label": "Find", spellcheck: "false", autocomplete: "off", "main-field": "true" });
  const replace = element("input", { class: "pg-find-input", placeholder: "Replace", "aria-label": "Replace", spellcheck: "false", autocomplete: "off" });
  const count = element("span", { class: "pg-find-count", role: "status", "aria-live": "polite" });
  const replaceRow = element("div", { class: "pg-find-row", hidden: "" });
  const dom = element("div", { class: "pg-find", role: "search", "aria-label": "Search in the editor" });

  let query = getSearchQuery(view.state);
  const change = (over: Partial<{ search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }>) => {
    query = new SearchQuery({ search: query.search, replace: query.replace, caseSensitive: query.caseSensitive, regexp: query.regexp, wholeWord: query.wholeWord, literal: query.literal, ...over });
    view.dispatch({ effects: setSearchQuery.of(query) });
  };

  const toggle = (label: string, title: string, key: "caseSensitive" | "regexp" | "wholeWord") => {
    const made = button(label, title, () => change({ [key]: !query[key] }), { "aria-pressed": "false" });
    made.dataset.option = key;
    return made;
  };
  const options = [toggle("Aa", "Match case", "caseSensitive"), toggle(".*", "Use a regular expression", "regexp"), toggle("ab", "Match whole words", "wholeWord")];

  const showReplace = button("›", "Show replace", () => {
    const open = replaceRow.hasAttribute("hidden");
    replaceRow.toggleAttribute("hidden", !open);
    showReplace.setAttribute("aria-expanded", String(open));
    showReplace.dataset.open = String(open);
    (open ? replace : input).focus();
  });
  showReplace.setAttribute("aria-expanded", "false");

  input.addEventListener("input", () => change({ search: input.value }));
  replace.addEventListener("input", () => change({ replace: replace.value }));
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.target === replace) replaceNext(view);
      else (event.shiftKey ? findPrevious : findNext)(view);
    }
  };
  input.addEventListener("keydown", keys);
  replace.addEventListener("keydown", keys);

  dom.append(
    element("div", { class: "pg-find-row" }, showReplace, input, count, button("↑", "Previous match (Shift+Enter)", () => findPrevious(view)), button("↓", "Next match (Enter)", () => findNext(view)), ...options, button("", "Close (Escape)", () => (closeSearchPanel(view), view.focus()), { "data-icon": "close" })),
  );
  replaceRow.append(replace, button("Replace", "Replace this match", () => replaceNext(view), { class: "pg-find-button pg-find-text" }), button("All", "Replace every match", () => replaceAll(view), { class: "pg-find-button pg-find-text" }));
  dom.append(replaceRow);

  const show = (state: EditorState) => {
    query = getSearchQuery(state);
    if (input.value !== query.search) input.value = query.search;
    if (replace.value !== query.replace) replace.value = query.replace;
    for (const made of options) made.setAttribute("aria-pressed", String(query[made.dataset.option as "caseSensitive" | "regexp" | "wholeWord"]));
    const matches = matchesIn(state, query);
    count.textContent = describe(matches, query);
    count.dataset.state = query.search !== "" && matches.total === 0 ? "none" : "ok";
    input.toggleAttribute("aria-invalid", query.search !== "" && (!query.valid || matches.total === 0));
  };
  show(view.state);

  return {
    dom,
    top: true,
    mount: () => {
      input.focus();
      input.select();
    },
    update: (update: ViewUpdate) => show(update.state),
  };
}

/** Search for an editor, with the bar above. */
export const searchBar: Extension = [
  search({ top: true, createPanel }),
  EditorView.theme({
    ".cm-panels": { backgroundColor: "transparent", border: "0", color: "inherit" },
    ".cm-panels-top": { borderBottom: "0" },
  }),
];
