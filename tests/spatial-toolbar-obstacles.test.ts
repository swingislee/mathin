// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from "three";
import { spatialSceneObstacles, toolbarDomObstacles, watchToolbarLayout } from "@/features/tools/spatial-interaction/toolbar-obstacles";

const size = { width: 800, height: 600 };
const camera = () => {
  const value = new OrthographicCamera(-4, 4, 3, -3, .1, 100);
  value.position.z = 10; value.updateMatrixWorld(); return value;
};
function rect(node: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("rendered object and label obstacles", () => {
  it("reads actual animated world matrices and individual visible instances, not a whole scene box", () => {
    const scene = new Scene(), group = new Group();
    group.userData.spatialToolbarObstacle = true; group.position.x = 1;
    const instances = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 3);
    instances.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0));
    instances.setMatrixAt(1, new Matrix4().makeTranslation(1, 0, 0)); instances.count = 2;
    group.add(instances); scene.add(group);
    const before = spatialSceneObstacles(scene, camera(), size);
    expect(before).toHaveLength(2);
    expect(before[0]).toEqual({ left: 246, right: 354, top: 246, bottom: 354 });
    expect(before[1].left - before[0].left).toBe(300);
    group.position.x = 0;
    expect(spatialSceneObstacles(scene, camera(), size)[0].left).toBe(before[0].left - 100);
    group.visible = false;
    expect(spatialSceneObstacles(scene, camera(), size)).toEqual([]);
  });
  it("protects picked solids and surface labels while skipping hidden materials, grids and hover hints", () => {
    const scene = new Scene(), group = new Group();
    group.userData.spatialObjectId = "solid";
    const solid = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    group.add(solid); scene.add(group, new Mesh(new BoxGeometry(30, .1, 30), new MeshBasicMaterial()));
    expect(spatialSceneObstacles(scene, camera(), size)).toHaveLength(1);
    solid.material.opacity = 0;
    expect(spatialSceneObstacles(scene, camera(), size)).toEqual([]);
    solid.material.opacity = 1; delete group.userData.spatialObjectId;
    solid.userData.spatialToolbarObstacle = true;
    expect(spatialSceneObstacles(scene, camera(), size)).toHaveLength(1);
    solid.position.z = 10;
    expect(spatialSceneObstacles(scene, camera(), size)).toEqual([{ left: 0, top: 0, right: 800, bottom: 600 }]);
    solid.position.z = 20;
    expect(spatialSceneObstacles(scene, camera(), size)).toEqual([]);
  });
});

describe("local DOM layout obstacles", () => {
  function stage() {
    const scope = document.createElement("section"), other = document.createElement("section");
    scope.innerHTML = '<svg><defs><rect width="960" height="720" /></defs><g data-spatial-toolbar-content><text>Length</text><polygon /></g></svg><div data-cube-canvas-panel></div><div data-spatial-object-toolbar><div role="toolbar"><button>Turn</button></div></div><div data-overlay><span>3 ones</span></div>';
    other.innerHTML = "<aside data-cube-canvas-panel></aside>";
    document.body.append(scope, other);
    return { scope, other, toolbar: scope.querySelector<HTMLElement>("[data-spatial-object-toolbar]")!, overlay: scope.querySelector("[data-overlay]")! };
  }
  it("includes SVG labels/materials, open panels and Html text, excluding itself and other workbenches", () => {
    const { scope, other, toolbar, overlay } = stage();
    scope.querySelectorAll("*").forEach((node) => rect(node, 110, 220, 20, 10));
    rect(other.firstElementChild!, 0, 0, 800, 600);
    const obstacles = toolbarDomObstacles(scope, toolbar, { left: 100, top: 200 }, overlay);
    expect(obstacles).toHaveLength(4);
    expect(obstacles.every((item) => item.left === 6 && item.top === 16 && item.right === 34 && item.bottom === 34)).toBe(true);
    scope.querySelector<HTMLElement>("[data-cube-canvas-panel]")!.style.display = "none";
    (scope.querySelector("g") as SVGElement).style.opacity = "0";
    expect(toolbarDomObstacles(scope, toolbar, { left: 100, top: 200 }, overlay)).toHaveLength(1);
  });
  it("refreshes on panel/label changes and font completion, ignores its own positioning and cleans up", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    const { scope, toolbar } = stage(), refresh = vi.fn(), stop = watchToolbarLayout(scope, toolbar, refresh);
    toolbar.style.left = "100px"; await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    scope.querySelector("text")!.textContent = "New length"; await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    scope.querySelector<HTMLElement>("[data-cube-canvas-panel]")!.style.display = "none"; await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(refresh).toHaveBeenCalledTimes(3);
    stop(); scope.querySelector("text")!.textContent = "After cleanup"; await Promise.resolve();
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("includes multiline solid readouts and projected section SVG without counting the full overlay", () => {
    const { scope, toolbar, overlay } = stage();
    overlay.innerHTML = '<span>Area 6<br/>Volume 4</span><svg><defs><path/></defs><polyline/><text>AB = 3</text></svg>';
    rect(overlay, 0, 0, 800, 600);
    overlay.querySelectorAll("span, polyline, text").forEach((node) => rect(node, 120, 140, 100, 40));
    const obstacles = toolbarDomObstacles(scope, toolbar, { left: 0, top: 0 }, overlay);
    expect(obstacles).toHaveLength(3);
    expect(obstacles.every((item) => item.left === 116 && item.right === 224)).toBe(true);
  });
  it("does not sustain demand frames when section readouts rewrite unchanged attributes", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const { scope, toolbar, overlay } = stage(), refresh = vi.fn();
    overlay.innerHTML = '<svg><polyline points="0,0 10,10"/></svg>';
    const line = overlay.querySelector("polyline")!, stop = watchToolbarLayout(scope, toolbar, refresh);
    for (let frame = 0; frame < 5; frame++) { line.setAttribute("points", "0,0 10,10"); await Promise.resolve(); }
    expect(refresh).not.toHaveBeenCalled();
    line.setAttribute("points", "0,0 20,20"); await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    line.setAttribute("points", "0,0 20,20"); await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1); stop();
  });
});
