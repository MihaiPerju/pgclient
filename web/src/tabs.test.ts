import { addTab, closeTab, placeTab, focusedTab, focusPane, mergePanes, moveTab, nudgeTab, parseLayout, selectTab, serializeLayout, splitPane, tabLabel, tabsOf, type Layout, type Tab } from "./tabs";

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


describe("dragging a tab", () => {
  const between = (pane: number, at: number) => ({ kind: "between", pane, at }) as const;
  const aside = { kind: "aside" } as const;

  test("let go in another gap of its own pane, it is put there", () => {
    expect(ids(placeTab(one("a", "b", "c"), "a", between(0, 2)))).toEqual([["b", "a", "c"]]);
    expect(ids(placeTab(one("a", "b", "c"), "c", between(0, 0)))).toEqual([["c", "a", "b"]]);
    expect(ids(placeTab(one("a", "b", "c"), "a", between(0, 3)))).toEqual([["b", "c", "a"]]);
  });

  test("the gap counts the tabs as they are before it is lifted, so the gaps either side of it leave it where it is", () => {
    expect(ids(placeTab(one("a", "b", "c"), "b", between(0, 1)))).toEqual([["a", "b", "c"]]);
    expect(ids(placeTab(one("a", "b", "c"), "b", between(0, 2)))).toEqual([["a", "b", "c"]]);
  });

  test("a gap beyond the ends is the end it is nearest", () => {
    expect(ids(placeTab(one("a", "b", "c"), "a", between(0, 99)))).toEqual([["b", "c", "a"]]);
    expect(ids(placeTab(one("a", "b", "c"), "c", between(0, -4)))).toEqual([["c", "a", "b"]]);
  });

  test("a tab that is dragged comes to the front of its pane and the pane is the one worked in", () => {
    const layout = placeTab({ ...two(["a", "b"], ["c", "d"]), focus: 0 }, "d", between(1, 0));

    expect(layout.panes[1].active).toBe("d");
    expect(layout.focus).toBe(1);
  });

  test("let go among the tabs of the other pane, it goes there at that place", () => {
    expect(ids(placeTab(two(["a", "b"], ["c", "d"]), "a", between(1, 1)))).toEqual([["b"], ["c", "a", "d"]]);
    expect(ids(placeTab(two(["a", "b"], ["c", "d"]), "d", between(0, 0)))).toEqual([["d", "a", "b"], ["c"]]);
  });

  test("it is in front in the pane it came to, and that pane is worked in", () => {
    const layout = placeTab(two(["a", "b"], ["c", "d"]), "a", between(1, 2));

    expect(layout.panes[1]).toMatchObject({ active: "a" });
    expect(layout.focus).toBe(1);
  });

  test("the pane it left brings forward the tab beside it if it was in front there", () => {
    expect(placeTab(two(["a", "b", "c"], ["d"]), "a", between(1, 0)).panes[0].active).toBe("b");
    expect(placeTab(two(["a", "b", "c"], ["d"]), "c", between(1, 0)).panes[0].active).toBe("a");
  });

  test("the pane it left keeps its own front tab when it was not the one in front", () => {
    const layout: Layout = { panes: [{ tabs: [tab("a"), tab("b"), tab("c")], active: "c" }, { tabs: [tab("d")], active: "d" }], focus: 0 };

    expect(placeTab(layout, "a", between(1, 1)).panes[0].active).toBe("c");
  });

  test("the last tab of a pane, taken to the other, closes the pane it left", () => {
    const layout = placeTab(two(["a"], ["b", "c"]), "a", between(1, 1));

    expect(ids(layout)).toEqual([["b", "a", "c"]]);
    expect(layout.focus).toBe(0);
  });

  test("when the first pane closes the place in the other is still the one that was meant", () => {
    const layout = placeTab(two(["a"], ["b", "c"]), "a", between(1, 2));

    expect(ids(layout)).toEqual([["b", "c", "a"]]);
  });

  test("let go off to the side, a tab of a single pane opens a pane of its own", () => {
    const layout = placeTab(one("a", "b"), "b", aside);

    expect(ids(layout)).toEqual([["a"], ["b"]]);
    expect(layout.focus).toBe(1);
  });

  test("the only tab there is has nothing to be beside, so it stays", () => {
    const alone = one("a");

    expect(placeTab(alone, "a", aside)).toBe(alone);
  });

  test("there is no third pane, so off to the side does nothing once the window is split", () => {
    const split = two(["a", "b"], ["c"]);

    expect(placeTab(split, "a", aside)).toBe(split);
  });

  test("a tab that is not there, or a pane that is not, changes nothing", () => {
    const layout = two(["a"], ["b"]);

    expect(placeTab(layout, "zzz", between(0, 0))).toBe(layout);
    expect(placeTab(layout, "a", between(5, 0))).toBe(layout);
    expect(placeTab(layout, "a", between(-1, 0))).toBe(layout);
  });

  test("no way of letting go loses a tab or doubles one", () => {
    const layouts = [one("a", "b", "c"), two(["a"], ["b", "c"]), two(["a", "b"], ["c"]), two(["a", "b", "c"], ["d", "e"])];
    for (const layout of layouts) {
      const before = tabsOf(layout).map((one) => one.id).sort();
      for (const id of before) {
        const drops = [aside, ...[0, 1].flatMap((pane) => [-1, 0, 1, 2, 3, 99].map((at) => between(pane, at)))];
        for (const drop of drops) {
          const after = placeTab(layout, id, drop);

          expect(tabsOf(after).map((one) => one.id).sort()).toEqual(before);
          expect(after.panes.every((pane) => pane.tabs.length > 0 && pane.tabs.some((tab) => tab.id === pane.active))).toBe(true);
          expect(after.focus).toBeGreaterThanOrEqual(0);
          expect(after.focus).toBeLessThan(after.panes.length);
        }
      }
    }
  });

  test("what the tab holds goes with it", () => {
    const layout: Layout = { panes: [{ tabs: [tab("a", "orders"), tab("b", "users")], active: "a" }, { tabs: [tab("c")], active: "c" }], focus: 0 };

    expect(placeTab(layout, "b", between(1, 0)).panes[1].tabs[0]).toEqual({ id: "b", serverId: "s1", database: "users" });
  });

  test("the layout it was given is not changed", () => {
    const layout = two(["a", "b"], ["c"]);
    const copy = JSON.parse(JSON.stringify(layout));
    placeTab(layout, "a", between(1, 0));

    expect(layout).toEqual(copy);
  });
});

describe("moving a tab a place with the keyboard", () => {
  test("a tab goes a place left or right in its pane", () => {
    expect(ids(nudgeTab(one("a", "b", "c"), "b", 1))).toEqual([["a", "c", "b"]]);
    expect(ids(nudgeTab(one("a", "b", "c"), "b", -1))).toEqual([["b", "a", "c"]]);
  });

  test("at the end it stays where it is", () => {
    const layout = one("a", "b");

    expect(ids(nudgeTab(layout, "a", -1))).toEqual([["a", "b"]]);
    expect(ids(nudgeTab(layout, "b", 1))).toEqual([["a", "b"]]);
  });

  test("a tab that is not there changes nothing", () => {
    const layout = one("a", "b");

    expect(nudgeTab(layout, "zzz", 1)).toBe(layout);
  });

  test("it keeps to its pane and leaves the other alone", () => {
    expect(ids(nudgeTab(two(["a", "b"], ["c", "d"]), "d", -1))).toEqual([["a", "b"], ["d", "c"]]);
  });
});
