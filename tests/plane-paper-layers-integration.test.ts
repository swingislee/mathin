// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlanarSnapshot, PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { planarCommit, planarFrame, planarHistory, planarPause } from "../src/features/tools/planar-kit/presentation";
import { constructPaperLayers, createPaperLayersState, foldStep, paperCuts, setPaperLayersField } from "../src/features/tools/plane-paper-layers/model";
import { planePaperLayersScene as scene } from "../src/features/tools/plane-paper-layers/scenes";
import { isValidPaperLayersState } from "../src/features/tools/plane-paper-layers/validation";
import { isValidPaperFoldingState } from "../src/features/tools/plane-paper-folding/validation";
import { firstFoldState, planePaperLayersCases, twoFoldState } from "./fixtures/plane-paper-layers-cases";

const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
function draw(s: PlanarState, extras: Partial<PlanarDrawingApi> = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.innerHTML = renderToStaticMarkup(scene.draw(s, { ...api, ...extras })); expect(svg.innerHTML).not.toMatch(/NaN|Infinity|undefined/); return svg;
}
const cutPaper = () => constructPaperLayers(twoFoldState(), "cut-circle", [{ x: 590, y: 450 }, { x: 610, y: 450 }])!;
const action = (id: string) => scene.actions!.find((item) => item.id === id)!;
const snapshot = (current: PlanarState): PlanarSnapshot => ({ current, past: [], future: [], motion: null });

describe("two-fold scene and private save contract", () => {
  it("starts from one quiet paper and adds crease, outline and cut handles only through explicit controls", () => {
    const initial = createPaperLayersState();
    expect(draw(initial).querySelectorAll("[data-paper-layer]")).toHaveLength(1); expect(draw(initial).querySelectorAll("text,[data-paper-handle]")).toHaveLength(0);
    const edit = action("paper-edit").run(initial, { selected: null }); expect(draw(edit).querySelectorAll("[data-paper-handle]")).toHaveLength(4);
    const prepared = foldStep(firstFoldState(), true); expect(draw(prepared, { operation: "fold" }).querySelectorAll("[data-paper-handle]")).toHaveLength(2);
    expect(draw(prepared).querySelectorAll("[data-paper-handle]")).toHaveLength(0);
    expect(draw(cutPaper()).querySelectorAll("[data-cut-editor]")).toHaveLength(4);
    expect(draw(cutPaper(), { editable: false }).querySelectorAll("[data-cut-editor]")).toHaveLength(0);
    const hidden = action("cut-edit").run(cutPaper(), { selected: null }); expect(draw(hidden).querySelectorAll("[data-cut-editor]")).toHaveLength(0);
  });
  it("subtracts analytic holes through each real source layer and uses per-instance mask IDs", () => {
    const s = cutPaper(), svg = draw(s); expect(svg.querySelectorAll("[data-paper-layer]")).toHaveLength(4);
    const centers = Array.from(svg.querySelectorAll("mask circle"), (circle) => [Number(circle.getAttribute("cx")), Number(circle.getAttribute("cy"))]);
    expect(centers).toEqual([[590, 450], [370, 450], [370, 290], [590, 290]]);
    expect(svg.querySelectorAll('[data-paper-layer] [fill="var(--paper)"]')).toHaveLength(0);
    for (const mask of Array.from(svg.querySelectorAll("mask"))) { expect(mask.querySelector("circle")?.getAttribute("fill")).toBe("black"); expect(mask.querySelector("circle")?.getAttribute("r")).toBe("20"); }
    svg.innerHTML = renderToStaticMarkup(createElement(Fragment, null, scene.draw(s, api), scene.draw(s, api)));
    const ids = Array.from(svg.querySelectorAll("[id]"), (element) => element.id); expect(new Set(ids).size).toBe(ids.length);
    for (const element of Array.from(svg.querySelectorAll("[mask],[clip-path]"))) for (const name of ["mask", "clip-path"]) { const value = element.getAttribute(name); if (value) expect(ids).toContain(value.slice(5, -1)); }
  });
  it("animates one hinge at a time and retains exact semantic endpoints through pause, late join and undo", () => {
    const from = cutPaper(), unfold = action("paper-unfold-next"), to = unfold.run(from, { selected: null });
    expect(to.params["foldAngle.0"]).toBe(180); expect(to.params["foldAngle.1"]).toBe(0);
    let snap = planarCommit(snapshot(from), from, to, { id: unfold.id, duration: 1800, now: 1000 });
    const frame = planarFrame(snap, scene, 1450); expect(frame.params["foldAngle.1"]).toBe(135); expect(scene.isExact!(frame)).toBe(false); expect(scene.isExact!(snap.current)).toBe(true);
    expect(planarFrame(JSON.parse(JSON.stringify(snap)), scene, 1450)).toEqual(frame);
    snap = planarPause(snap, 1450, true); expect(planarFrame(snap, scene, 99000)).toEqual(frame);
    snap = planarPause(snap, 10000, false); expect(planarFrame(snap, scene, 11350)).toEqual(to);
    expect(planarHistory(snap, "undo").current).toEqual(from); expect(planarHistory(planarHistory(snap, "undo"), "redo").current).toEqual(to);
    expect(paperCuts(frame)).toEqual(paperCuts(from));
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) expect(draw(unfold.interpolate!(from, to, progress)).querySelectorAll("[data-paper-layer]")).toHaveLength(4);
  });
  it("keeps independent edits in reversible history and never silently resets the other cuts", () => {
    const one = cutPaper(), two = constructPaperLayers(one, "cut-polygon", [{ x: 640, y: 540 }, { x: 720, y: 540 }, { x: 680, y: 585 }])!;
    const selected = setPaperLayersField(two, "activeCut", 1), removed = action("cut-delete").run(selected, { selected: null });
    expect(paperCuts(removed).map((cut) => cut.id)).toEqual([2]); expect(paperCuts(removed)[0]).toEqual(paperCuts(two)[1]);
    const committed = planarCommit(snapshot(selected), selected, removed); expect(planarHistory(committed, "undo").current).toEqual(selected);
    expect(action("fold-delete-last").disabled!(two, { selected: null })).toBe(true);
  });
  it("guards construction state, accurate fields and show-only measures without imposing a canned conclusion", () => {
    const tools = scene.construction!.tools, base = createPaperLayersState(), first = firstFoldState(), second = twoFoldState();
    expect(tools.find((tool) => tool.id === "crease")!.disabled!(base)).toBe(false); expect(tools.find((tool) => tool.id === "crease")!.disabled!(second)).toBe(true);
    expect(tools.find((tool) => tool.id === "cut-circle")!.disabled!(base)).toBe(true); expect(tools.find((tool) => tool.id === "cut-circle")!.disabled!(first)).toBe(false);
    expect(tools.find((tool) => tool.id === "cut-circle")!.disabled!(setPaperLayersField(first, "foldAngle", 100))).toBe(true);
    for (const s of [base, first, second, cutPaper()]) for (const operation of scene.operations!) for (const field of operation.fields!) expect(Number.isFinite(field.read!(s)), field.key).toBe(true);
    expect(draw({ ...second, flags: { ...second.flags, measures: true } }).textContent).toContain("104.5 u²");
    expect(draw({ ...cutPaper(), flags: { ...second.flags, measures: true } }).textContent).not.toContain("u²");
    expect(scene.construction!.preview("cut-circle", [{ x: 500, y: 400 }, { x: 520, y: 400 }])).toBeTruthy();
  });
  it("supplies consistent v3 fixture semantics while preserving legacy v2 state readability", () => {
    for (const entry of planePaperLayersCases()) {
      if (entry.scene.contentVersion === "plane-folding-lesson-v1") continue;
      const { scene: envelope } = entry, titleLength = envelope.payload.title.trim().length;
      const valid = envelope.toolId === "plane-folding" && titleLength >= 1 && titleLength <= 80 && (envelope.contentVersion === "plane-folding-lesson-v3" ? isValidPaperLayersState(envelope.payload.initial) : envelope.contentVersion === "plane-folding-lesson-v2" && isValidPaperFoldingState(envelope.payload.initial));
      expect(valid, entry.label).toBe(entry.accepted);
    }
  });
  it("declares only private helpers, matches title trim/UTF-16 and retains bounded payload shape", () => {
    const sql = readFileSync("supabase/migrations/20261004031000_tool_plane_paper_layers.sql", "utf8");
    const declared = Array.from(sql.matchAll(/create function public\.([a-z_]+)\(([^)]*)\)/g), (match) => match[1]);
    expect(declared).toHaveLength(4); for (const name of declared) { expect(name.startsWith("tool_plane_paper_layers_")).toBe(true); expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public,anon,authenticated,service_role;`)); }
    expect(sql).toContain("\\FEFF"); expect(sql).toContain("octet_length(codepoint)=4"); expect(sql).toContain("jsonb_object_keys(p))>256"); expect(sql).toContain("total_points>192");
    expect(sql).not.toMatch(/create or replace|grant |insert into|update public\.|delete from|alter table/i);
  });
});
