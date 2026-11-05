import { addTab, closeTab, focusedTab, focusPane, mergePanes, moveTab, parseLayout, selectTab, serializeLayout, splitPane, tabLabel, tabsOf, type Layout, type Tab } from "./tabs";

const IDS = ["s1", "s2"];
const tab = (id: string, database = "app"): Tab => ({ id, serverId: "s1", database });
const one = (...ids: string[]): Layout => ({ panes: [{ tabs: ids.map((id) => tab(id)), active: ids[0] }], focus: 0 });
const two = (left: string[], right: string[]): Layout => ({
  panes: [
    { tabs: left.map((id) => tab(id)), active: left[0] },
    { tabs: right.map((id) => tab(id)), active: right[0] },
  ],
  focus: 0,
});
const ids = (layout: Layout) => layout.panes.map((pane) => pane.tabs.map((one) => one.id));

describe("what was kept of the tabs", () => {
  test("it comes back as it was kept, with its panes and the one being worked in", () => {
    const layout: Layout = { panes: [{ tabs: [{ id: "a", serverId: "s1", database: "app" }], active: "a" }, { tabs: [{ id: "b", serverId: "s2", database: null }], active: "b" }], focus: 1 };

    expect(parseLayout(serializeLayout(layout), IDS)).toEqual(layout);
  });

  test("what was kept before the window could be split is one pane", () => {
    const layout = parseLayout('{"tabs":[{"id":"a","serverId":"s1","database":"x"},{"id":"b","serverId":"s1","database":"y"}],"active":"b"}', IDS);

    expect(layout).toEqual({ panes: [{ tabs: [tab("a", "x"), tab("b", "y")], active: "b" }], focus: 0 });
  });

  test("nothing, or something that is not tabs, is no layout", () => {
    for (const text of [undefined, "", "not json", "{}", '{"tabs": []}', '{"tabs": "x"}', '{"panes": []}', '{"panes": [{"tabs": []}]}']) expect(parseLayout(text, IDS)).toBeNull();
  });

  test("a tab on a server that is gone is kept, with no target", () => {
    const layout = parseLayout('{"panes":[{"tabs":[{"id":"a","serverId":"gone","database":"app"}],"active":"a"}],"focus":0}', IDS);

    expect(layout?.panes[0].tabs).toEqual([{ id: "a", serverId: null, database: null }]);
  });

  test("an entry with no id, or an id seen already even in another pane, is dropped", () => {
    const layout = parseLayout('{"panes":[{"tabs":[{"serverId":"s1"},{"id":"a","serverId":"s1","database":"x"}]},{"tabs":[{"id":"a","serverId":"s2"},{"id":"b","serverId":"s2"}]}]}', IDS);

    expect(ids(layout!)).toEqual([["a"], ["b"]]);
  });

  test("a pane with nothing in it is left out, and no more than two are kept", () => {
    const layout = parseLayout('{"panes":[{"tabs":[]},{"tabs":[{"id":"a"}]},{"tabs":[{"id":"b"}]},{"tabs":[{"id":"c"}]}]}', IDS);

    expect(ids(layout!)).toEqual([["a"], ["b"]]);
  });

  test("a front tab or a pane that is not there is the first", () => {
    expect(parseLayout('{"panes":[{"tabs":[{"id":"a"}],"active":"zzz"}],"focus":7}', IDS)).toMatchObject({ panes: [{ active: "a" }], focus: 0 });
    expect(parseLayout('{"panes":[{"tabs":[{"id":"a"}]}],"focus":-1}', IDS)?.focus).toBe(0);
  });
});

describe("working in the panes", () => {
  test("the tab in front in the pane being worked in is the one that is focused", () => {
    expect(focusedTab({ ...two(["a"], ["b"]), focus: 1 })?.id).toBe("b");
  });

  test("choosing a tab brings it to the front and works in its pane", () => {
    const layout = selectTab(two(["a", "b"], ["c"]), "b");

    expect(layout.panes[0].active).toBe("b");
    expect(layout.focus).toBe(0);
    expect(selectTab(layout, "c").focus).toBe(1);
  });

  test("choosing a tab that is not there changes nothing", () => {
    const layout = one("a");

    expect(selectTab(layout, "zzz")).toBe(layout);
  });

  test("focusing the pane already worked in, or one that is not there, changes nothing", () => {
    const layout = two(["a"], ["b"]);

    expect(focusPane(layout, 0)).toBe(layout);
    expect(focusPane(layout, 5)).toBe(layout);
    expect(focusPane(layout, 1).focus).toBe(1);
  });

  test("a new tab goes at the end of the pane being worked in, in front", () => {
    const layout = addTab({ ...two(["a"], ["b"]), focus: 1 }, tab("c"));

    expect(ids(layout)).toEqual([["a"], ["b", "c"]]);
    expect(layout.panes[1].active).toBe("c");
  });
});

describe("splitting", () => {
  test("it opens a second pane with the tab given, and works in it", () => {
    const layout = splitPane(one("a"), tab("b"));

    expect(ids(layout)).toEqual([["a"], ["b"]]);
    expect(layout.focus).toBe(1);
  });

  test("there are never more than two", () => {
    const layout = two(["a"], ["b"]);

    expect(splitPane(layout, tab("c"))).toBe(layout);
  });

  test("moving a tab to a pane of its own needs another tab to stay behind", () => {
    const alone = one("a");

    expect(moveTab(alone, "a")).toBe(alone);
    expect(ids(moveTab(one("a", "b"), "b"))).toEqual([["a"], ["b"]]);
    expect(moveTab(one("a", "b"), "b").focus).toBe(1);
  });

  test("a tab moved to the other pane goes to the end of it, in front, and the pane it left shows the tab next to it", () => {
    const layout = moveTab(two(["a", "b", "c"], ["d"]), "a");

    expect(ids(layout)).toEqual([["b", "c"], ["d", "a"]]);
    expect(layout.panes[0].active).toBe("b");
    expect(layout.panes[1].active).toBe("a");
    expect(layout.focus).toBe(1);
  });

  test("moving the only tab of a pane closes the pane, and the window is not split any more", () => {
    const layout = moveTab(two(["a"], ["b"]), "b");

    expect(ids(layout)).toEqual([["a", "b"]]);
    expect(layout.focus).toBe(0);
  });
});

describe("putting the panes back together", () => {
  test("every tab ends up in one pane, those of the pane worked in first, and none is lost", () => {
    const layout = mergePanes({ ...two(["a", "b"], ["c"]), focus: 1 });

    expect(ids(layout)).toEqual([["c", "a", "b"]]);
    expect(layout.panes[0].active).toBe("c");
    expect(layout.focus).toBe(0);
  });

  test("a window that is not split is left as it is", () => {
    const layout = one("a", "b");

    expect(mergePanes(layout)).toBe(layout);
  });
});

describe("closing", () => {
  test("the tab next to it comes to the front", () => {
    const layout = closeTab(one("a", "b", "c"), "a");

    expect(layout.panes[0].active).toBe("b");
    expect(closeTab({ ...one("a", "b", "c"), panes: [{ tabs: one("a", "b", "c").panes[0].tabs, active: "c" }] }, "c").panes[0].active).toBe("b");
  });

  test("a tab that is not in front leaves the front tab alone", () => {
    expect(closeTab(one("a", "b", "c"), "c").panes[0].active).toBe("a");
  });

  test("the last tab of a pane takes the pane with it, and the other pane is worked in", () => {
    const layout = closeTab({ ...two(["a"], ["b", "c"]), focus: 0 }, "a");

    expect(ids(layout)).toEqual([["b", "c"]]);
    expect(layout.focus).toBe(0);
  });

  test("the pane that was worked in keeps being, when the other is closed", () => {
    const layout = closeTab({ ...two(["a"], ["b"]), focus: 1 }, "a");

    expect(ids(layout)).toEqual([["b"]]);
    expect(layout.focus).toBe(0);
  });

  test("the last tab of all cannot be closed", () => {
    const layout = one("a");

    expect(closeTab(layout, "a")).toBe(layout);
    expect(tabsOf(closeTab(layout, "a"))).toHaveLength(1);
  });
});

describe("what a tab is called", () => {
  const servers = [
    { id: "s1", name: "aeon", environment: "prod" as const },
    { id: "s2", name: "Local", environment: null },
  ];

  test("the database, and which server it is on in the title", () => {
    expect(tabLabel({ id: "a", serverId: "s1", database: "app" }, servers)).toEqual({ label: "app", title: "app on aeon – prod", environment: "prod" });
  });

  test("a tab with a server and no database yet is called by its server", () => {
    expect(tabLabel({ id: "a", serverId: "s2", database: null }, servers)).toMatchObject({ label: "Local", environment: null });
  });

  test("a tab with no server is new", () => {
    expect(tabLabel({ id: "a", serverId: null, database: null }, servers).label).toBe("New tab");
  });
});
