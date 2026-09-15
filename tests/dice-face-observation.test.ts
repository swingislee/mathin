import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrthographicCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { DiceFaceInspection } from "@/features/tools/spatial-lab/DiceFaceInspection";
import { DICE_FACE_EXTRACTION, diceBodyScreenBounds, diceFaceCorners, diceFaceScreenBounds, diceScreenRectsOverlap, planDiceFaceObservations, type DiceObservationView } from "@/features/tools/spatial-lab/dice-face-observation";
import { DICE_FACES, DICE_ORIENTATIONS, arrangeDice, closeDieFaces, controlledRoll, createDiceScene, diceFaceTranslation, interpolateDice, isDiceFaceMoved, quaternion, worldNormal, type DiceFace } from "@/features/tools/spatial-lab/dice-teaching-model";
import { closeDiceFaces, diceFaceArrows, restoreDiceScene } from "@/features/tools/spatial-lab/dice-teaching-display";

function makeView(width = 800, height = 600): DiceObservationView {
  const camera = new OrthographicCamera(-3.375 * width / height, 3.375 * width / height, 3.375, -3.375, 0.01, 1000);
  camera.position.set(10, 8.5, 10); camera.lookAt(0, 0.5, 0); camera.updateMatrixWorld();
  return { camera, width, height, floor: true, obstacles: [
    { left: width - 300, top: 8, right: width - 8, bottom: 44 },
    { left: width - 48, top: 52, right: width - 8, bottom: height - 8 },
    { left: 8, top: 8, right: 135, bottom: 44 },
  ] };
}

describe("view-aware dice face observation", () => {
  it.each([[800, 600], [600, 450]])("separates facing faces across a one-die gap at %s × %s", (width, height) => {
    const scene = createDiceScene(), view = makeView(width, height);
    scene.dice[0].hidden = ["x+"]; scene.dice[1].surfaces = { "x-": { color: "#df8a84", opacity: 0.4 } };
    const before = JSON.stringify(scene), cameraBefore = view.camera.matrixWorld.toArray();
    const first = planDiceFaceObservations(scene.dice, "dice-1", ["x+"], view);
    const second = planDiceFaceObservations(first.dice, "dice-2", ["x-"], view);
    expect(first.failures).toEqual([]); expect(second.failures).toEqual([]);
    for (const [index, face] of [[0, "x+"], [1, "x-"]] as const) {
      const rect = diceFaceScreenBounds(second.dice[index], face, view, true);
      expect(rect.left).toBeGreaterThanOrEqual(12); expect(rect.right).toBeLessThanOrEqual(width - 12);
      expect(rect.top).toBeGreaterThanOrEqual(12); expect(rect.bottom).toBeLessThanOrEqual(height - 12);
      expect(second.dice.every((die) => !diceScreenRectsOverlap(rect, diceBodyScreenBounds(die, view)))).toBe(true);
      expect(view.obstacles.every((obstacle) => !diceScreenRectsOverlap(rect, obstacle))).toBe(true);
      expect(second.dice[index].rotation).toEqual(scene.dice[index].rotation);
      expect(second.dice[index].hidden).toEqual(scene.dice[index].hidden);
      expect(second.dice[index].surfaces).toEqual(scene.dice[index].surfaces);
    }
    expect(diceScreenRectsOverlap(diceFaceScreenBounds(second.dice[0], "x+", view, true), diceFaceScreenBounds(second.dice[1], "x-", view, true))).toBe(false);
    expect(second.dice[0]).toBe(first.dice[0]);
    expect(JSON.stringify(scene)).toBe(before); expect(view.camera.matrixWorld.toArray()).toEqual(cameraBefore);
  });
  it("reserves endpoints for an opposite pair and later faces, including an open side panel", () => {
    const view = makeView();
    view.obstacles = [...view.obstacles, { left: 468, top: 52, right: 744, bottom: 492 }];
    const initial = createDiceScene().dice;
    const pair = planDiceFaceObservations(initial, "dice-1", ["y+", "y-"], view);
    expect(pair.failures).toEqual([]);
    const extra = planDiceFaceObservations(pair.dice, "dice-2", ["z-"], view);
    expect(extra.failures).toEqual([]);
    const moved = extra.dice.flatMap((die) => DICE_FACES.filter((face) => isDiceFaceMoved(die, face)).map((face) => diceFaceScreenBounds(die, face, view, true)));
    expect(moved).toHaveLength(3);
    moved.forEach((a, i) => moved.slice(i + 1).forEach((b) => expect(diceScreenRectsOverlap(a, b)).toBe(false)));
  });
  it("keeps every already chosen landing unchanged after camera rotation or die selection", () => {
    const view = makeView(), first = planDiceFaceObservations(createDiceScene().dice, "dice-1", ["z-"], view);
    expect(first.failures).toEqual([]);
    const snapshot = JSON.stringify(first.dice);
    view.camera.position.set(-10, 8, 10); view.camera.lookAt(0, 0.5, 0); view.camera.updateMatrixWorld();
    const again = planDiceFaceObservations(first.dice, "dice-1", ["z-"], view);
    expect(again.dice[0]).toBe(first.dice[0]);
    diceFaceArrows(first.dice, "dice-2", () => "face");
    expect(JSON.stringify(first.dice)).toBe(snapshot);
  });
  it("preserves real orientation and lifts bottom-facing pieces above the visible table", () => {
    const scene = createDiceScene(), view = makeView();
    for (const rotation of DICE_ORIENTATIONS) {
      const die = { ...scene.dice[0], rotation };
      const result = planDiceFaceObservations([die], die.id, ["y+"], view);
      expect(result.failures).toEqual([]);
      const moved = result.dice[0];
      expect(moved.rotation).toEqual(rotation);
      expect(worldNormal(moved, "y+").distanceTo(worldNormal(die, "y+"))).toBeCloseTo(0);
      expect(Math.min(...diceFaceCorners(moved, "y+").map((p) => p.y))).toBeGreaterThanOrEqual(0.0799);
    }
  });
  it("offers explicit inspection for edge-on faces or a full viewport without forcing a landing", () => {
    const scene = createDiceScene(), view = makeView();
    view.camera.position.set(0, 0.5, 10); view.camera.lookAt(0, 0.5, 0); view.camera.updateMatrixWorld();
    expect(planDiceFaceObservations(scene.dice, "dice-1", ["x+"], view).failures[0].reason).toBe("side-on");
    const back = planDiceFaceObservations(scene.dice, "dice-1", ["z-"], view);
    expect(back.failures).toEqual([]);
    expect(diceScreenRectsOverlap(diceFaceScreenBounds(back.dice[0], "z-", view), diceBodyScreenBounds(scene.dice[0], view))).toBe(false);
    view.obstacles = [{ left: 0, top: 0, right: view.width, bottom: view.height }];
    const crowded = planDiceFaceObservations(scene.dice, "dice-1", ["z+"], view);
    expect(crowded.failures[0].reason).toBe("no-space"); expect(crowded.dice).toEqual(scene.dice);
  });
  it("extracts before shifting, returns on the reverse path, and keeps the source anchored", () => {
    const before = createDiceScene().dice, after = planDiceFaceObservations(before, "dice-1", ["x+"], makeView()).dice;
    const early = interpolateDice(before, after, 0.1)[0], middle = interpolateDice(before, after, 0.5)[0];
    expect(early.offsets["x+"]).toBeGreaterThan(0); expect(early.offsets["x+"]).toBeLessThan(DICE_FACE_EXTRACTION);
    expect(new Vector3(...Object.values(early.faceShifts!["x+"]!)).length()).toBeCloseTo(0);
    expect(middle.offsets["x+"]).toBeCloseTo(DICE_FACE_EXTRACTION);
    const closed = after.map((die) => closeDieFaces(die));
    for (const progress of [0, 0.1, 0.22, 0.5, 0.78, 0.9, 1]) {
      const opening = interpolateDice(before, after, progress)[0], closing = interpolateDice(after, closed, 1 - progress)[0];
      expect(diceFaceTranslation(opening, "x+").distanceTo(diceFaceTranslation(closing, "x+"))).toBeCloseTo(0);
      expect(diceFaceCorners(opening, "x+", false)).toEqual(diceFaceCorners(before[0], "x+", false));
    }
    const worldShift = diceFaceTranslation(after[0], "x+").applyQuaternion(quaternion(after[0].rotation));
    expect(diceFaceCorners(after[0], "x+")[0].clone().sub(diceFaceCorners(before[0], "x+")[0]).distanceTo(worldShift)).toBeCloseTo(0);
  });
  it("clears both movement components on reset and blocks rolling a shifted face", () => {
    const scene = createDiceScene();
    scene.dice = planDiceFaceObservations(scene.dice, "dice-1", ["x+"], makeView()).dice;
    scene.dice[0] = { ...scene.dice[0], offsets: {} };
    expect(controlledRoll(scene, "dice-1", "z+", false)).toBeNull();
    for (const dice of [closeDiceFaces(scene).dice, restoreDiceScene(scene).dice, arrangeDice(scene.dice, "apart")]) {
      expect(dice.every((die) => DICE_FACES.every((face) => !isDiceFaceMoved(die, face)))).toBe(true);
    }
  });
  it("never reveals hidden pips in the front-facing copy, including accessible markup", () => {
    const die = createDiceScene().dice[0], face: DiceFace = "y-";
    const hidden = renderToStaticMarkup(createElement(DiceFaceInspection, { die: { ...die, hidden: [face] }, face, locale: "zh", label: "下面" }));
    expect(hidden).toContain("已隐藏"); expect(hidden).not.toContain("<circle"); expect(hidden).not.toContain("下面 · 6");
    const visible = renderToStaticMarkup(createElement(DiceFaceInspection, { die, face, locale: "en", label: "Bottom" }));
    expect(visible.match(/<circle/g)).toHaveLength(6);
  });
  it("works on LAN HTTP without randomUUID or new scene identities", () => {
    vi.stubGlobal("crypto", {});
    try {
      const scene = createDiceScene(), result = planDiceFaceObservations(scene.dice, "dice-1", ["z-"], makeView());
      expect(result.failures).toEqual([]);
      expect(result.dice.map((die) => die.id)).toEqual(scene.dice.map((die) => die.id));
    } finally { vi.unstubAllGlobals(); }
  });
  it("uses click-time camera capture, shared panels, stable selection and no automatic camera fitting", () => {
    const source = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    const move = source.slice(source.indexOf("const openFaces ="), source.indexOf("const roll ="));
    expect(move).not.toContain("setCameraKey"); expect(move).not.toContain("setFrame"); expect(move).not.toContain("1.1");
    expect(source).toContain("onSelect={setSelectedId}"); expect(source).toContain("<DiceFaceInspection"); expect(source).toContain("<CubeCanvasPanel");
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain("camera: camera.clone()"); expect(canvas).toContain("getBoundingClientRect()");
    expect(canvas).toContain("diceFaceTranslation(die, face)"); expect(canvas).toContain("diceFaceCorners(die, face, false)");
  });
});
