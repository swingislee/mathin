// @vitest-environment jsdom
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FollowupRecordRow, FollowupTableBody } from "@/features/school/dashboard-page/FollowupRecordRow";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const navigate = vi.fn();
type Item = { id: string; children?: ReactNode; pending?: boolean };
function Records({ name, items, open = [], blocked = false, tree = false }: {
  name: string; items: Item[]; open?: string[]; blocked?: boolean; tree?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(new Set(open));
  return h("table", { "data-test-table": name }, h(FollowupTableBody, {
    navigation: tree ? "tree" : "records", onNavigate: key => {
      navigate(name, key); if (blocked) return false; setActive(key); return true;
    },
  }, items.map(item => h(FollowupRecordRow, {
    key: item.id, rowKey: item.id, active: active === item.id, expanded: expanded.has(item.id), pending: item.pending,
    onActivate: () => setActive(item.id), onExpandedChange: value => setExpanded(current => {
      const next = new Set(current); if (value) next.add(item.id); else next.delete(item.id); return next;
    }),
    detailsId: `${name}-${item.id}`, title: item.id, colSpan: 1, keepMounted: true,
    rowProps: { "data-test-row": `${name}:${item.id}` },
    summary: h("td", null, item.id, h("button", { type: "button" }, "Action")),
  }, item.children ?? h("textarea", { defaultValue: "keep this draft" })))));
}
function Hierarchy({ closed = false, parentPending = false, blocked, emptyStudents = false }: { closed?: boolean; parentPending?: boolean; blocked?: string; emptyStudents?: boolean }) {
  return h("main", null,
    h(Records, { name: "classes", tree: true, open: closed ? [] : ["class"], blocked: blocked === "classes", items: [
      { id: "class", pending: parentPending, children: h(Records, { name: "lessons", open: ["lesson"], blocked: blocked === "lessons", items: [
        { id: "lesson", children: h("div", null,
          h(Records, { name: "students", blocked: blocked === "students", items: emptyStudents ? [] : [{ id: "one" }, { id: "two" }] }),
          h(Records, { name: "notes", blocked: blocked === "notes", items: [{ id: "one" }, { id: "two" }] }),
        ) },
        { id: "next-lesson" },
      ] }) },
      { id: "next-class" },
    ] }),
    h(Records, { name: "parallel", items: [{ id: "one" }] }),
  );
}
let root: Root, container: HTMLDivElement;
const row = (id: string) => container.querySelector<HTMLElement>(`[data-test-row="${id}"]`)!;
const press = async (target: HTMLElement, key: string, extra = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  await act(async () => target.dispatchEvent(event)); return event;
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn(); navigate.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("nested record table navigation", () => {
  it("enters each expanded child table and activates the row in its own scope", async () => {
    await act(async () => root.render(h(Hierarchy)));
    await press(row("classes:class"), "ArrowDown");
    expect(document.activeElement).toBe(row("lessons:lesson"));
    await press(row("lessons:lesson"), "ArrowDown");
    expect(document.activeElement).toBe(row("students:one"));
    expect(row("students:one").dataset.followupActive).toBe("true");
    expect(navigate.mock.calls).toEqual([["classes", "class"], ["lessons", "lesson"], ["lessons", "lesson"], ["students", "one"]]);
    await press(row("students:one"), "ArrowUp");
    expect(document.activeElement).toBe(row("lessons:lesson"));
    const detail = document.getElementById("lessons-lesson")!;
    await press(detail, "ArrowDown");
    expect(document.activeElement).toBe(row("students:one"));
    await press(row("students:one"), "ArrowDown");
    expect(document.activeElement).toBe(row("students:two"));
  });

  it("uses Alt + arrows for same-level records while regular arrows visit their descendants", async () => {
    await act(async () => root.render(h(Hierarchy)));
    await press(row("lessons:lesson"), "ArrowDown", { altKey: true });
    expect(document.activeElement).toBe(row("lessons:next-lesson"));
    await press(row("lessons:next-lesson"), "ArrowUp", { altKey: true });
    expect(document.activeElement).toBe(row("lessons:lesson"));
    await press(row("classes:class"), "ArrowDown", { altKey: true });
    expect(document.activeElement).toBe(row("classes:next-class"));
    await press(row("classes:next-class"), "ArrowUp");
    expect(document.activeElement).toBe(row("lessons:next-lesson"));
  });

  it("uses Tab between parallel tables, restoring their active row and keeping duplicate keys separate", async () => {
    await act(async () => root.render(h(Hierarchy)));
    await press(row("lessons:lesson"), "ArrowDown");
    await press(row("students:one"), "ArrowDown");
    await press(row("students:two"), "Tab");
    expect(document.activeElement).toBe(row("notes:one"));
    expect(navigate).toHaveBeenLastCalledWith("notes", "one");
    await press(row("notes:one"), "ArrowDown");
    expect(document.activeElement).toBe(row("notes:two"));
    await press(row("notes:two"), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(row("students:two"));
    await press(row("students:two"), "Tab");
    expect(document.activeElement).toBe(row("notes:two"));
    expect((await press(row("notes:two"), "Tab")).defaultPrevented).toBe(false);
    await press(row("classes:class"), "Tab");
    expect(document.activeElement).toBe(row("parallel:one"));
  });

  it("skips retained hidden children and leaves control Tab, editing, overlays and IME alone", async () => {
    await act(async () => root.render(h(Hierarchy, { closed: true })));
    expect(row("students:one")).toBeTruthy();
    await press(row("classes:class"), "ArrowDown");
    expect(document.activeElement).toBe(row("classes:next-class"));
    await press(row("classes:class"), "Enter");
    await press(row("students:one"), "Enter");
    const input = document.getElementById("students-one")!.querySelector("textarea")!;
    for (const [key, extra] of [["ArrowDown", {}], ["ArrowDown", { altKey: true }], ["Tab", {}]] as const) {
      expect((await press(input, key, extra)).defaultPrevented).toBe(false);
    }
    expect((await press(row("students:one").querySelector("button")!, "Tab")).defaultPrevented).toBe(false);
    expect((await press(row("students:one"), "Tab", { isComposing: true })).defaultPrevented).toBe(false);
    expect((await press(row("students:one"), "ArrowDown", { isComposing: true })).defaultPrevented).toBe(false);
    const overlay = document.createElement("div"); overlay.setAttribute("role", "listbox"); row("students:one").firstElementChild!.append(overlay);
    expect((await press(overlay, "Tab")).defaultPrevented).toBe(false);
    expect(input.value).toBe("keep this draft");
  });

  it.each(["source", "destination", "pending"])("respects %s guards before crossing into a child table", async guard => {
    await act(async () => root.render(h(Hierarchy, { parentPending: guard === "pending", blocked: guard === "source" ? "classes" : guard === "destination" ? "lessons" : undefined })));
    await act(async () => row("classes:class").focus());
    await press(row("classes:class"), "ArrowDown");
    expect(document.activeElement).toBe(row("classes:class"));
  });

  it("resolves an empty inner table to its parent record without sending that key to the empty table", async () => {
    await act(async () => root.render(h(Hierarchy, { emptyStudents: true })));
    await press(container.querySelector<HTMLElement>('[data-test-table="students"] tbody')!, "ArrowDown");
    expect(document.activeElement).toBe(row("notes:one"));
    expect(navigate.mock.calls).toEqual([["lessons", "lesson"], ["notes", "one"]]);
  });

  it.each(["students", "notes"])("keeps parallel-table focus in place when %s rejects navigation", async blocked => {
    await act(async () => root.render(h(Hierarchy, { blocked })));
    await act(async () => row("students:one").focus());
    await press(row("students:one"), "Tab");
    expect(document.activeElement).toBe(row("students:one"));
  });
});
