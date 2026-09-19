import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera } from "three";
import { createSolidEntity } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { cubeScreenPoint } from "@/features/tools/spatial-lab/cube-structures-drag";
import { createSolidSectionSettings, solidSectionSettingsSchema } from "@/features/tools/solid-sections/solid-sections-contract";
import { bindSolidSectionDrag, sectionDragHandles, sectionDragHit, sectionDragProjection, sectionDragSettings, type SectionDragInteraction } from "@/features/tools/solid-sections/solid-section-drag";
import { sectionReadoutLayout, sectionReadoutPoints } from "@/features/tools/solid-sections/solid-section-readout";
import { intersectSolidSection, sectionDot, sectionPlaneBasis, solidSectionNormal, solidSectionPlane } from "@/features/tools/solid-sections/solid-sections";

const size = { width: 800, height: 600 };
function camera(top = false) {
  const value = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100);
  value.position.set(top ? 0 : 5, 7, top ? 0 : 9); value.up.set(0, top ? 0 : 1, top ? -1 : 0);
  value.lookAt(0, 0, 0); value.updateMatrixWorld(); return value;
}
const entity = createSolidEntity("cube", "cube", { x: 0, y: 0, z: 0 });
const settings = { ...createSolidSectionSettings(), enabled: true };
class Surface extends EventTarget {
  style = { cursor: "" }; captured = new Set<number>();
  ownerDocument = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  getBoundingClientRect() { return { ...size, left: 0, top: 0 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
function setup(part: "offset" | "tiltA" | "tiltB" = "offset") {
  const surface = new Surface(), onCommit = vi.fn(), preview = vi.fn(), gesture = vi.fn(), view = camera();
  let interaction: SectionDragInteraction | null = { entity, settings, onCommit };
  const start = cubeScreenPoint(sectionDragHandles(entity, settings)[part], view, size);
  const projection = sectionDragProjection(interaction, part, view, size);
  const dispose = bindSolidSectionDrag(surface as unknown as HTMLCanvasElement, () => interaction, () => view, preview, gesture);
  const send = (type: string, amount = 0, pointerId = 1) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { pointerId, button: 0, isPrimary: true, clientX: start.x + projection.x * amount, clientY: start.y + projection.y * amount });
    (type === "pointerdown" || type === "lostpointercapture" ? surface : surface.ownerDocument).dispatchEvent(event); return event;
  };
  return { surface, onCommit, preview, gesture, send, dispose, change: () => { interaction = null; } };
}
describe("direct section manipulation", () => {
  it("hits the visible plane or its handles and leaves empty space for orbiting", () => {
    const interaction = { entity, settings, onCommit: vi.fn() }, view = camera();
    expect(sectionDragHit({ x: 400, y: 300 }, interaction, view, size)).toBe("offset");
    expect(sectionDragHit({ x: 790, y: 580 }, interaction, view, size)).toBeNull();
    for (const part of ["offset", "tiltA", "tiltB"] as const) expect(sectionDragHit(cubeScreenPoint(sectionDragHandles(entity, settings)[part], view, size), interaction, view, size)).toBe(part);
    expect(sectionDragHit({ x: 400, y: 300 }, { ...interaction, settings: { ...settings, showPlane: false } }, view, size)).toBeNull();
  });
  it.each(["offset", "tiltA", "tiltB"] as const)("previews %s continuously and commits exactly once", (part) => {
    const drag = setup(part), amount = part === "offset" ? 0.45 : 22;
    expect(drag.send("pointerdown").defaultPrevented).toBe(true); expect(drag.surface.hasPointerCapture(1)).toBe(true);
    drag.send("pointermove", amount / 2); drag.send("pointermove", amount);
    expect(drag.preview.mock.lastCall![0][part]).toBeCloseTo(amount); expect(drag.onCommit).not.toHaveBeenCalled();
    drag.send("pointerup", amount); drag.send("pointerup", amount);
    expect(drag.onCommit).toHaveBeenCalledTimes(1); expect(drag.onCommit.mock.lastCall![0][part]).toBeCloseTo(amount);
    expect(drag.preview.mock.lastCall![0]).toBeNull(); expect(drag.surface.captured.size).toBe(0); drag.dispose();
  });
  it.each(["pointercancel", "lostpointercapture", "Escape", "blur", "unmount", "external-state"])("%s discards the transient gesture", (action) => {
    const drag = setup(); drag.send("pointerdown"); drag.send("pointermove", 0.5);
    if (action === "Escape") drag.surface.ownerDocument.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    else if (action === "blur") drag.surface.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    else if (action === "unmount") drag.dispose();
    else if (action === "external-state") { drag.change(); drag.send("pointermove", 0.7); }
    else drag.send(action, 0.5);
    drag.send("pointerup", 0.5); expect(drag.onCommit).not.toHaveBeenCalled(); expect(drag.surface.captured.size).toBe(0); expect(drag.preview.mock.lastCall![0]).toBeNull(); drag.dispose();
  });
  it("does not write on a tap and handles a collapsed normal without an explosive jump", () => {
    const drag = setup(); drag.send("pointerdown"); drag.send("pointerup"); expect(drag.onCommit).not.toHaveBeenCalled(); drag.dispose();
    const projection = sectionDragProjection({ entity, settings, onCommit: vi.fn() }, "offset", camera(true), size);
    const next = sectionDragSettings(settings, "offset", { x: 0, y: -33 }, projection);
    expect(next.offset).toBeCloseTo(0.25); expect(solidSectionSettingsSchema.safeParse(next).success).toBe(true);
    expect(sectionDragSettings(settings, "offset", { x: 0, y: -1e6 }, projection).offset).toBe(1.2);
    expect(sectionDragSettings(settings, "tiltA", { x: 0, y: -1e6 }, { x: 0, y: -2 }).tiltA).toBe(90);
  });
});
describe("linked, constant-scale section readout", () => {
  it("keeps plane orientation continuous through the old reference-axis switch", () => {
    const a = sectionPlaneBasis(solidSectionNormal({ axis: "y", tiltA: 25.7, tiltB: 0 }));
    const b = sectionPlaneBasis(solidSectionNormal({ axis: "y", tiltA: 25.9, tiltB: 0 }));
    expect(sectionDot(a.u, b.u)).toBeGreaterThan(0.999); expect(sectionDot(a.v, b.v)).toBeGreaterThan(0.999);
    expect(sectionDot(b.u, b.normal)).toBeCloseTo(0); expect(sectionDot(b.v, b.normal)).toBeCloseTo(0);
  });
  it("makes a small pyramid section smaller instead of normalizing both to a full thumbnail", () => {
    const pyramid = createSolidEntity("square-pyramid", "pyramid", { x: 0, y: 0, z: 0 });
    const at = (offset: number) => { const plane = solidSectionPlane(pyramid, { x: 0, y: 1, z: 0 }, offset); return sectionReadoutPoints(pyramid, plane, intersectSolidSection(pyramid, plane)); };
    const span = (points: { x: number; y: number }[]) => Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    expect(span(at(0.5)) / span(at(0))).toBeCloseTo(0.5);
  });
  it("links the actual section centroid and stays inside a 4:3 stage when the camera changes", () => {
    const plane = solidSectionPlane(entity, { x: 0, y: 1, z: 0 }, 0.5), result = intersectSolidSection(entity, plane);
    for (const view of [camera(), camera(true)]) {
      const layout = sectionReadoutLayout(entity, plane, result, view, size), point = cubeScreenPoint(plane.origin, view, size);
      expect(layout.source.x).toBeCloseTo(point.x); expect(layout.source.y).toBeCloseTo(point.y);
      expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.left + layout.width).toBeLessThan(size.width); expect(layout.top + layout.width).toBeLessThan(size.height);
    }
  });
});
