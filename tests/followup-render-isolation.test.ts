// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FollowupTableRecord, type FollowupRowState } from "@/features/school/dashboard-page/FollowupTableRecord";

describe("follow-up record rendering", () => {
  it("updates only affected records and retains mounted draft fields when focus moves", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    type Row = { id: string; name: string };
    const rows: Row[] = Array.from({ length: 100 }, (_, index) => ({ id: String(index), name: `Student ${index}` }));
    const Record = FollowupTableRecord<Row>;
    const renderRow = vi.fn((row: Row, state: FollowupRowState) => createElement(Fragment, null,
      createElement("tr", { "data-record": row.id }, createElement("td", null, row.name)),
      state.expanded ? createElement("tr", null, createElement("td", null,
        createElement("textarea", { "aria-label": "Draft", defaultValue: "" }))) : null,
    ));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = async (active: string | null, expanded: string | null) => act(async () => {
      root.render(createElement("table", null, createElement("tbody", null, rows.map(row =>
        createElement(Record, { key: row.id, row, active: row.id === active, expanded: row.id === expanded, render: renderRow }),
      ))));
    });
    try {
      await render(null, null);
      const summary = container.querySelector('[data-record="0"]');
      renderRow.mockClear();
      await render("0", "0");
      expect(renderRow.mock.calls.map(([row]) => row.id)).toEqual(["0"]);
      expect(container.querySelector('[data-record="0"]')).toBe(summary);
      const draft = container.querySelector("textarea")!;
      draft.value = "Unsaved local note";
      renderRow.mockClear();
      await render("99", "0");
      expect(renderRow.mock.calls.map(([row]) => row.id)).toEqual(["0", "99"]);
      expect(container.querySelector("textarea")).toBe(draft);
      expect(draft.value).toBe("Unsaved local note");
      rows[1] = { ...rows[1], name: "Updated student" };
      renderRow.mockClear();
      await render("99", "0");
      expect(renderRow.mock.calls.map(([row]) => row.id)).toEqual(["1"]);
      expect(container.querySelector('[data-record="1"]')?.textContent).toBe("Updated student");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
