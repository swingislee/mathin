import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FollowupInlineDetails } from "@/features/school/dashboard-page/FollowupInlineDetails";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

function renderTable(open: boolean) {
  return renderToStaticMarkup(createElement("table", { style: { tableLayout: "fixed", width: "100%" } },
    createElement("colgroup", null, createElement("col", { style: { width: "14rem" } }), createElement("col", { style: { width: "24rem" } })),
    createElement("tbody", null,
      createElement("tr", { id: "record", style: { height: "64px" } }, createElement("td", null, "学生"), createElement("td", null, "安排及快捷录入")),
      createElement(FollowupInlineDetails, { open, onOpenChange: () => {}, title: "学生录入", colSpan: 2, id: "entry" }, createElement("input", { "aria-label": "详细记录" })),
      createElement("tr", { id: "next-record" }, createElement("td", { colSpan: 2 }, "下一条记录")),
    ),
  ));
}

describe("follow-up inline details", () => {
  it("adds details between the selected record and the next record without modifying either summary or columns", () => {
    const closed = renderTable(false);
    const open = renderTable(true);
    expect(open.match(/<tr\b/g)).toHaveLength(3);
    expect(closed.match(/<tr\b/g)).toHaveLength(2);
    expect(open.match(/<colgroup>.*?<\/colgroup>/)?.[0]).toBe(closed.match(/<colgroup>.*?<\/colgroup>/)?.[0]);
    expect(open.match(/<tr id="record".*?<\/tr>/)?.[0]).toBe(closed.match(/<tr id="record".*?<\/tr>/)?.[0]);
    expect(open.match(/<tr id="next-record".*?<\/tr>/)?.[0]).toBe(closed.match(/<tr id="next-record".*?<\/tr>/)?.[0]);
    const renderedRows = open.match(/<tr\b.*?<\/tr>/g)!;
    expect(renderedRows[1]).toContain('id="entry"');
    expect(renderedRows[1]).toMatch(/<td\b[^>]*colspan="2"/i);
    expect(renderedRows[1]).toContain('<input aria-label="详细记录"');
    expect(renderedRows[2]).toContain('id="next-record"');
    expect(open).toContain('role="region" aria-label="学生录入"');
    expect(open).not.toContain('role="dialog"');
    expect(closed).not.toContain('aria-label="详细记录"');
  });
});
