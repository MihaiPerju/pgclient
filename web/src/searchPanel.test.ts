import { openSearchPanel, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { COUNT_LIMIT, describe as say, matchesIn, searchBar } from "./searchPanel";

const query = (search: string, over: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}) => new SearchQuery({ search, ...over });
const state = (doc: string, selection?: { anchor: number; head: number }) => EditorState.create({ doc, selection: selection ? EditorSelection.single(selection.anchor, selection.head) : undefined });

describe("counting the matches", () => {
  test("every match is counted, and the one the selection is on is found", () => {
    const found = matchesIn(state("select a, select b, select c", { anchor: 10, head: 16 }), query("select"));

    expect(found).toEqual({ total: 3, more: false, current: 2 });
  });

  test("a selection that is on none of them is on none", () => {
    expect(matchesIn(state("select a, select b", { anchor: 0, head: 3 }), query("select")).current).toBe(0);
  });

  test("it is case sensitive only when asked to be", () => {
    const doc = state("Select SELECT select");

    expect(matchesIn(doc, query("select")).total).toBe(3);
    expect(matchesIn(doc, query("select", { caseSensitive: true })).total).toBe(1);
  });

  test("whole words and regular expressions are honoured", () => {
    const doc = state("cat concat cat");

    expect(matchesIn(doc, query("cat", { wholeWord: true })).total).toBe(2);
    expect(matchesIn(doc, query("c.t", { regexp: true })).total).toBe(3);
  });

  test("a regular expression that is not one has no matches, and nothing typed has none either", () => {
    expect(matchesIn(state("abc"), query("(", { regexp: true }))).toEqual({ total: 0, more: false, current: 0 });
    expect(matchesIn(state("abc"), query(""))).toEqual({ total: 0, more: false, current: 0 });
  });

  test("a document with more than the limit is counted up to it and says there are more", () => {
    const found = matchesIn(state("a".repeat(COUNT_LIMIT + 50)), query("a"));

    expect(found).toMatchObject({ total: COUNT_LIMIT, more: true });
  });
});

describe("what the count says", () => {
  const say_ = (doc: string, search: string, over: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}, at?: { anchor: number; head: number }) => {
    const q = query(search, over);
    return say(matchesIn(state(doc, at), q), q);
  };

  test("nothing until something is typed", () => {
    expect(say_("abc", "")).toBe("");
  });

  test("which match of how many", () => {
    expect(say_("ab ab ab", "ab", {}, { anchor: 3, head: 5 })).toBe("2 of 3");
  });

  test("how many there are, when the selection is on none", () => {
    expect(say_("ab ab ab", "ab", {}, { anchor: 0, head: 1 })).toBe("3 found");
  });

  test("that there is nothing, or that the expression is not one", () => {
    expect(say_("abc", "zzz")).toBe("No results");
    expect(say_("abc", "(", { regexp: true })).toBe("Not a valid expression");
  });

  test("a plus where the count stopped at the limit", () => {
    expect(say_("a".repeat(COUNT_LIMIT + 5), "a")).toBe(`${COUNT_LIMIT}+ found`);
  });
});

describe("the bar in an editor", () => {
  let host: HTMLElement;
  let view: EditorView;
  const open = (doc = "select a, select b") => {
    host = document.body.appendChild(document.createElement("div"));
    view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions: [searchBar] }) });
    openSearchPanel(view);
    return view;
  };
  afterEach(() => {
    view?.destroy();
    host?.remove();
  });
  const bar = () => host.querySelector(".pg-find") as HTMLElement;
  const field = (name: string) => bar().querySelector(`input[aria-label="${name}"]`) as HTMLInputElement;
  const press = (label: string) => (bar().querySelector(`button[aria-label^="${label}"]`) as HTMLButtonElement).click();
  const type = (input: HTMLInputElement, text: string) => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const count = () => bar().querySelector(".pg-find-count")!.textContent;

  test("it opens with the find field focused, and the replace field out of the way", () => {
    open();

    expect(bar()).toBeTruthy();
    expect(document.activeElement).toBe(field("Find"));
    expect(field("Replace").parentElement!.hasAttribute("hidden")).toBe(true);
  });

  test("typing counts the matches as it goes", () => {
    open();

    type(field("Find"), "select");
    expect(count()).toBe("2 found");

    type(field("Find"), "zzz");
    expect(count()).toBe("No results");
    expect(field("Find").hasAttribute("aria-invalid")).toBe(true);
  });

  test("next and previous move the selection from match to match, and the count follows", () => {
    open();
    type(field("Find"), "select");

    press("Next match");
    expect(count()).toBe("1 of 2");
    press("Next match");
    expect(count()).toBe("2 of 2");
    press("Previous match");
    expect(count()).toBe("1 of 2");
  });

  test("Enter is next and Shift Enter is previous", () => {
    open();
    type(field("Find"), "select");

    field("Find").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(count()).toBe("1 of 2");
    field("Find").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(count()).toBe("2 of 2");
  });

  test("the options are buttons that show whether they are on, and change what is found", () => {
    open("Select select");
    type(field("Find"), "select");
    expect(count()).toBe("2 found");

    press("Match case");

    expect(count()).toBe("1 found");
    expect(bar().querySelector('[data-option="caseSensitive"]')).toHaveAttribute("aria-pressed", "true");
    expect(bar().querySelector('[data-option="regexp"]')).toHaveAttribute("aria-pressed", "false");
  });

  test("a regular expression that is not one says so", () => {
    open();
    press("Use a regular expression");

    type(field("Find"), "(");

    expect(count()).toBe("Not a valid expression");
  });

  test("replace is shown on request, and replaces one match or every match", () => {
    open("select a, select b");
    type(field("Find"), "select");
    press("Show replace");
    expect(field("Replace").parentElement!.hasAttribute("hidden")).toBe(false);
    type(field("Replace"), "pick");

    // With the selection on no match, the first press goes to one, as in other editors; the next replaces it.
    press("Replace this match");
    expect(view.state.doc.toString()).toBe("select a, select b");
    press("Replace this match");
    expect(view.state.doc.toString()).toBe("pick a, select b");

    press("Replace every match");
    expect(view.state.doc.toString()).toBe("pick a, pick b");
    expect(count()).toBe("No results");
  });

  test("Escape closes it", () => {
    open();

    field("Find").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(host.querySelector(".pg-find")).toBeNull();
  });

  test("what was searched for is there again when the bar is opened again", () => {
    open();
    type(field("Find"), "select");
    field("Find").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    openSearchPanel(view);

    expect(field("Find").value).toBe("select");
    expect(count()).toBe("2 found");
  });

  test("a query set from outside shows in the field", () => {
    open();

    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "from outside" })) });

    expect(field("Find").value).toBe("from outside");
  });

  test("the buttons have names, so they can be found without seeing them", () => {
    open();

    for (const name of ["Show replace", "Previous match", "Next match", "Match case", "Use a regular expression", "Match whole words", "Close"]) expect(bar().querySelector(`button[aria-label^="${name}"]`)).not.toBeNull();
  });
});
