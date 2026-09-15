import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { AlwaysDepth, AlwaysStencilFunc, DoubleSide, EdgesGeometry, EqualStencilFunc, Group, KeepStencilOp, LessDepth, Mesh, MeshBasicMaterial, OrthographicCamera, Raycaster, ReplaceStencilOp, Texture, Vector2, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { DiceXRayOverlay } from "@/features/tools/spatial-lab/DiceXRayOverlay";
import { createDiceTapGuard, DICE_XRAY_OCCLUDER, DICE_XRAY_SURFACE, DICE_XRAY_WINDOW, diceXRayDisplay, diceXRayPick, nextDiceXRayTarget } from "@/features/tools/spatial-lab/dice-xray-observation";
import { diceFaceGeometries } from "@/features/tools/spatial-lab/dice-teaching-geometry";
import { DICE_FACES, DICE_ORIENTATIONS, FACE_NORMALS, createDiceScene, diceFaceTranslation, faceValue, oppositeFace, quaternion, vector, worldNormal } from "@/features/tools/spatial-lab/dice-teaching-model";
import { diceTeachingMessages } from "@/features/tools/spatial-lab/dice-teaching-messages";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)];
}

describe("in-place dice X-ray observation", () => {
  it("observes the true opposite at all 24 orientations on both handed dice without moving anything", () => {
    const scene = createDiceScene();
    for (const original of scene.dice) for (const rotation of DICE_ORIENTATIONS) for (const face of DICE_FACES) {
      const die = { ...original, rotation, offsets: { "x+": 1.1 } };
      const before = JSON.stringify(die), target = nextDiceXRayTarget(null, { id: die.id, face });
      const display = diceXRayDisplay([die], target)!;
      expect(display.die).toBe(die); expect(display.face).toBe(oppositeFace(face));
      expect(worldNormal(die, display.face).dot(worldNormal(die, face))).toBeCloseTo(-1);
      expect(display.textureValue + faceValue(die.hand, face)).toBe(7);
      expect(worldNormal(die, display.face).dot(vector(FACE_NORMALS[display.direction]))).toBeCloseTo(1);
      expect(JSON.stringify(die)).toBe(before);
    }
  });

  it("preserves hidden pips, paint, opacity, moved faces, clues and history when switching or clearing focus", () => {
    const scene = createDiceScene();
    scene.dice[0].hidden = ["z-"];
    scene.dice[0].surfaces = { "z-": { color: "#df8a84", opacity: 0.35 } };
    scene.dice[0].offsets = { "y+": 1.1 };
    scene.dice[1].offsets = { "x-": 0.7 };
    scene.puzzle = { scope: "each", target: 7, revealed: false };
    const history = { past: [createDiceScene()], present: scene, future: [] }, snapshot = JSON.stringify(history);
    const first = nextDiceXRayTarget(null, { id: "dice-1", face: "z+" });
    expect(diceXRayDisplay(scene.dice, first)).toMatchObject({ face: "z-", textureValue: 0, surface: { color: "#df8a84", opacity: 0.35 } });
    const second = nextDiceXRayTarget(first, { id: "dice-2", face: "x+" });
    expect(second).toEqual({ id: "dice-2", face: "x-" });
    expect(nextDiceXRayTarget(second, second!)).toBeNull();
    expect(diceXRayDisplay(scene.dice, null)).toBeNull();
    expect(diceXRayDisplay(scene.dice, { id: "removed-die", face: "y+" })).toBeNull();
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it("prioritizes the visible X-ray target even when the ray hits another die first", () => {
    const dice = createDiceScene().dice, geometries = diceFaceGeometries(), material = new MeshBasicMaterial({ side: DoubleSide });
    dice[0].position = { x: 0, y: 0.5, z: 0 }; dice[1].position = { x: 0, y: 0.5, z: 2 };
    const target = { id: dice[0].id, face: "z-" as const }, root = new Group();
    for (const die of dice) {
      const group = new Group(); group.position.copy(vector(die.position)); group.quaternion.copy(quaternion(die.rotation)); root.add(group);
      DICE_FACES.forEach((face, index) => { const mesh = new Mesh(geometries[index], material); mesh.name = `${die.id}/${face}`; mesh.position.copy(diceFaceTranslation(die, face)); group.add(mesh); });
    }
    const overlay = new Mesh(geometries[DICE_FACES.indexOf(target.face)], material); overlay.name = DICE_XRAY_SURFACE;
    root.children[0].add(overlay); root.updateMatrixWorld(true);
    const camera = new OrthographicCamera(-3, 3, 2.25, -2.25, 0.01, 100); camera.position.set(0, 0.5, 10); camera.lookAt(0, 0.5, 0); camera.updateMatrixWorld();
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(0, 0), camera);
    const hits = ray.intersectObject(root, true), clicked = { id: dice[1].id, face: "z+" as const };
    expect(hits[0].object.name).toBe("dice-2/z+");
    expect(hits.find((hit) => hit.object.name === DICE_XRAY_SURFACE)!.distance).toBeGreaterThan(hits[0].distance);
    expect(diceXRayPick(target, clicked, hits)).toBe(target);
    expect(nextDiceXRayTarget(target, diceXRayPick(target, clicked, hits))).toBeNull();
    expect(diceXRayPick(target, clicked, hits.filter((hit) => hit.object !== overlay))).toBe(clicked);
    material.dispose(); geometries.forEach((geometry) => geometry.dispose());
  });

  it("renders the same rounded face geometry and transform, keeps opacity, and gives occluders no pip material", () => {
    const dice = createDiceScene().dice;
    dice[0].rotation = DICE_ORIENTATIONS[7]; dice[0].offsets = { "z-": 1.1 };
    dice[0].surfaces = { "z-": { opacity: 0.35 } };
    const display = diceXRayDisplay(dice, { id: dice[0].id, face: "z-" })!;
    const geometries = diceFaceGeometries(), edges = geometries.map((geometry) => new EdgesGeometry(geometry, 25));
    const texture = { map: new Texture(), bump: new Texture() };
    const tree = elements(DiceXRayOverlay({ dice, display, geometries, edges, texture, interactive: true, onClick: () => {} }));
    const face = tree.find((node) => node.props.name === DICE_XRAY_SURFACE)!;
    expect(face.props.geometry).toBe(geometries[5]);
    expect(tree.some((node) => (node.props.position as Vector3)?.equals?.(diceFaceTranslation(dice[0], "z-")))).toBe(true);
    expect(tree.some((node) => (node.props.quaternion as ReturnType<typeof quaternion>)?.equals?.(quaternion(dice[0].rotation)))).toBe(true);
    const surface = tree.find((node) => node.type === "meshPhysicalMaterial")!;
    expect(surface.props.map).toBe(texture.map); expect(surface.props.opacity).toBe(0); expect(surface.props.depthTest).toBe(false);
    expect(display.surface.opacity).toBe(0.35); expect(surface.props.name).toBe("dice-xray-face");
    const outlines = tree.filter((node) => node.type === "lineBasicMaterial" && node.props.stencilWrite);
    expect(outlines).toHaveLength(11); expect(outlines.every((node) => !node.props.map)).toBe(true);
    expect(tree.filter((node) => node.props.renderOrder).map((node) => node.props.renderOrder)).toContain(100);
    geometries.forEach((geometry) => geometry.dispose()); edges.forEach((edge) => edge.dispose()); texture.map.dispose(); texture.bump.dispose();
  });

  it("limits ghosting to the target projection and only to outlines in front of its depth", () => {
    expect(DICE_XRAY_WINDOW).toMatchObject({ depthTest: true, depthFunc: AlwaysDepth, depthWrite: true, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
    expect(DICE_XRAY_OCCLUDER).toMatchObject({ depthTest: true, depthFunc: LessDepth, depthWrite: false, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
    expect(DICE_XRAY_WINDOW.stencilRef).toBe(DICE_XRAY_OCCLUDER.stencilRef);
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain("stencil: true");
    const transition = readFileSync("src/features/tools/spatial-lab/DiceXRayTransition.tsx", "utf8");
    expect(transition).toContain("textures.get(display.surface.color)![display.textureValue]");
  });

  it("distinguishes taps from orbit drags, including a return to the start, pinch and cancellation", () => {
    const tap = createDiceTapGuard(), start = { pointerId: 1, clientX: 100, clientY: 100 };
    tap.down(start); expect(tap.isTap()).toBe(false); tap.up(start); expect(tap.isTap()).toBe(true);
    tap.down(start); tap.move({ ...start, clientX: 150 }); tap.up(start); expect(tap.isTap()).toBe(false);
    tap.down(start); tap.down({ ...start, pointerId: 2 }); tap.up({ ...start, pointerId: 2 }); tap.up(start); expect(tap.isTap()).toBe(false);
    tap.down(start); tap.cancel(start); expect(tap.isTap()).toBe(false);
    tap.down(start); tap.reset(); expect(tap.isTap()).toBe(false);
    tap.down(start); tap.up({ ...start, clientX: 101 }); expect(tap.isTap()).toBe(true);
  });

  it("has a shared toolbar entry, blank-click exit, orbit support and a non-mutating mode toggle", () => {
    const workspace = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    const toggle = workspace.slice(workspace.indexOf("const toggleXRay ="), workspace.indexOf("const fit ="));
    for (const mutation of ["commit(", "animate(", "setHistory", "setFrame", "setCameraKey", "setArrows", "closeDiceFaces"]) expect(toggle).not.toContain(mutation);
    expect(workspace).toContain('<CubeIconButton label={m.xray}'); expect(workspace).toContain("<ScanEye />");
    expect(workspace).toContain('data-dice-xray={xray ? xrayPresentation.phase : "ready"}');
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain("onPointerMissed="); expect(canvas).toContain("props.onClearXRay()");
    expect(canvas).toContain("onPointerMoveCapture={tap.move}"); expect(canvas).toContain('navigationMode={props.tool === "pan" ? "pan" : props.tool === "move" ? "object" : "orbit"}');
    expect(canvas).toContain('props.arrows && props.tool !== "xray"');
    expect(Object.keys(diceTeachingMessages("zh"))).toEqual(Object.keys(diceTeachingMessages("en")));
  });

  it("needs no secure-context UUID or new scene IDs on LAN HTTP", () => {
    vi.stubGlobal("crypto", {});
    try {
      const scene = createDiceScene(), target = nextDiceXRayTarget(null, { id: scene.dice[0].id, face: "y+" });
      expect(diceXRayDisplay(scene.dice, target)!.die).toBe(scene.dice[0]);
    } finally { vi.unstubAllGlobals(); }
  });
});
