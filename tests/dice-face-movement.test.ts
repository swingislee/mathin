import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiceFaceInspection } from "@/features/tools/spatial-lab/DiceFaceInspection";
import { diceFaceCorners } from "@/features/tools/spatial-lab/dice-teaching-geometry";
import { DICE_FACES, DICE_FACE_MOVE_DISTANCE, DICE_ORIENTATIONS, arrangeDice, closeDieFaces, controlledRoll, createDiceScene, diceFaceTranslation, interpolateDice, isDiceFaceMoved, openDieFaces, oppositeFace, quaternion, worldNormal, type DiceFace } from "@/features/tools/spatial-lab/dice-teaching-model";
import { closeDiceFaces, diceFaceArrow, diceFaceArrows, restoreDiceScene } from "@/features/tools/spatial-lab/dice-teaching-display";

describe("straight dice face movement", () => {
  it("keeps all six faces open at 0.9 die widths without repositioning either die", () => {
    const scene = createDiceScene(), before = JSON.stringify(scene);
    let moved = scene.dice[0];
    for (const face of DICE_FACES) moved = openDieFaces(moved, [face]);
    expect(DICE_FACE_MOVE_DISTANCE).toBe(0.9);
    expect(moved.position).toBe(scene.dice[0].position); expect(moved.rotation).toBe(scene.dice[0].rotation);
    const middle = interpolateDice([scene.dice[0]], [moved], 0.5)[0];
    for (const face of DICE_FACES) {
      expect(diceFaceTranslation(moved, face).length()).toBeCloseTo(0.9);
      expect(diceFaceTranslation(middle, face).length()).toBeCloseTo(0.45);
    }
    const snapshot = JSON.stringify(moved);
    diceFaceArrows([moved, scene.dice[1]], scene.dice[1].id, () => "face");
    expect(JSON.stringify(moved)).toBe(snapshot); expect(JSON.stringify(scene)).toBe(before);
    expect(DICE_FACES.every((face) => !isDiceFaceMoved(closeDieFaces(moved), face))).toBe(true);
  });

  it("moves every face only along its normal, including every opening and returning frame", () => {
    for (const original of createDiceScene().dice) for (const rotation of DICE_ORIENTATIONS) for (const face of DICE_FACES) {
      const before = { ...original, rotation }, after = openDieFaces(before, [face]);
      const normal = worldNormal(before, face);
      expect(diceFaceTranslation(after, face).length()).toBeCloseTo(DICE_FACE_MOVE_DISTANCE);
      for (const progress of [0, 0.1, 0.22, 0.5, 0.78, 0.9, 1]) {
        const opening = interpolateDice([before], [after], progress)[0];
        const closing = interpolateDice([after], [closeDieFaces(after)], 1 - progress)[0];
        const translation = diceFaceTranslation(opening, face).applyQuaternion(quaternion(rotation));
        expect(translation.distanceTo(normal.clone().multiplyScalar(DICE_FACE_MOVE_DISTANCE * progress))).toBeCloseTo(0);
        expect(diceFaceTranslation(opening, face).distanceTo(diceFaceTranslation(closing, face))).toBeCloseTo(0);
        expect(opening.position).toEqual(before.position);
        expect(Math.abs(quaternion(opening.rotation).dot(quaternion(rotation)))).toBeCloseTo(1);
      }
    }
  });

  it("opens opposite faces in opposite directions without a special bottom-face route", () => {
    const before = createDiceScene().dice[0];
    for (const face of DICE_FACES) {
      const opposite = oppositeFace(face), after = openDieFaces(before, [face, opposite]);
      expect(diceFaceTranslation(after, face).add(diceFaceTranslation(after, opposite)).length()).toBeCloseTo(0);
      expect(after.position).toBe(before.position); expect(after.rotation).toBe(before.rotation);
    }
    expect(diceFaceTranslation(openDieFaces(before, ["y-"]), "y-").toArray()).toEqual([0, -DICE_FACE_MOVE_DISTANCE, 0]);
  });

  it("preserves other faces, dice, styles and clues, with no repeated movement on selection", () => {
    const scene = createDiceScene();
    scene.dice[0].hidden = ["x+"]; scene.dice[0].surfaces = { "x+": { color: "#df8a84", opacity: 0.4 } };
    scene.puzzle = { scope: "each", target: 7, revealed: false };
    const before = JSON.stringify(scene);
    const next = { ...scene, dice: scene.dice.map((die) => die.id === "dice-1" ? openDieFaces(die, ["x+", "z-"]) : die) };
    expect(next.dice[1]).toBe(scene.dice[1]); expect(next.puzzle).toBe(scene.puzzle);
    expect(next.dice[0].hidden).toBe(scene.dice[0].hidden); expect(next.dice[0].surfaces).toBe(scene.dice[0].surfaces);
    expect(openDieFaces(next.dice[0], ["x+"])).toBe(next.dice[0]); expect(openDieFaces(next.dice[0], [])).toBe(next.dice[0]);
    const closed = closeDieFaces(next.dice[0], ["x+"]);
    expect(closed.offsets).toEqual({ "z-": DICE_FACE_MOVE_DISTANCE });
    const snapshot = JSON.stringify(next);
    expect(diceFaceArrows(next.dice, "dice-2", () => "face")).toHaveLength(6);
    expect(JSON.stringify(next)).toBe(snapshot); expect(JSON.stringify(scene)).toBe(before);
  });

  it("keeps source outlines anchored and arrows aligned with the straight return path", () => {
    for (const rotation of DICE_ORIENTATIONS) for (const face of DICE_FACES) {
      const before = { ...createDiceScene().dice[0], rotation }, after = openDieFaces(before, [face]);
      const source = diceFaceCorners(before, face), destination = diceFaceCorners(after, face);
      const translation = worldNormal(before, face).multiplyScalar(DICE_FACE_MOVE_DISTANCE);
      expect(diceFaceCorners(after, face, false)).toEqual(source);
      destination.forEach((point, index) => expect(point.clone().sub(source[index]).distanceTo(translation)).toBeCloseTo(0));
      const openedArrow = diceFaceArrow(after, face, "face"), closedArrow = diceFaceArrow(before, face, "face");
      expect(openedArrow.center.clone().sub(closedArrow.center).distanceTo(translation)).toBeCloseTo(0);
      expect(closedArrow.direction.dot(worldNormal(before, face))).toBeCloseTo(1);
      expect(openedArrow.direction.dot(worldNormal(before, face))).toBeCloseTo(-1);
    }
  });

  it("closes scalar movement on restore and allows rolling only after all faces are closed", () => {
    const scene = createDiceScene();
    scene.dice[0] = openDieFaces(scene.dice[0], ["x+", "y-"]);
    expect(controlledRoll(scene, "dice-1", "z+", false)).toBeNull();
    for (const dice of [closeDiceFaces(scene).dice, restoreDiceScene(scene).dice, arrangeDice(scene.dice, "apart")]) {
      expect(dice.every((die) => DICE_FACES.every((face) => !isDiceFaceMoved(die, face)))).toBe(true);
      expect(controlledRoll({ ...scene, dice }, "dice-1", "z+", false)).not.toBeNull();
    }
  });

  it("ignores obsolete extra displacement data in old in-memory objects", () => {
    const scene = createDiceScene();
    const legacy = { ...scene.dice[0], faceShifts: { "x+": { x: 0.4, y: 0.3, z: -0.2 } } };
    expect(isDiceFaceMoved(legacy, "x+")).toBe(false);
    expect(controlledRoll({ ...scene, dice: [legacy, scene.dice[1]] }, legacy.id, "z+", false)).not.toBeNull();
    const opened = openDieFaces(legacy, ["x+"]);
    expect(diceFaceTranslation(opened, "x+").toArray()).toEqual([DICE_FACE_MOVE_DISTANCE, 0, 0]);
    expect(diceFaceTranslation(interpolateDice([legacy], [opened], 0.5)[0], "x+").toArray()).toEqual([DICE_FACE_MOVE_DISTANCE / 2, 0, 0]);
    expect(diceFaceArrow(opened, "x+", "face").direction.toArray()).toEqual([-1, -0, -0]);
    expect(isDiceFaceMoved(closeDieFaces(opened), "x+")).toBe(false);
  });

  it("keeps hidden pips hidden in front-facing copies and accessible markup", () => {
    const die = createDiceScene().dice[0], face: DiceFace = "y-";
    const hidden = renderToStaticMarkup(createElement(DiceFaceInspection, { die: { ...die, hidden: [face] }, face, locale: "zh", label: "下面" }));
    expect(hidden).toContain("已隐藏"); expect(hidden).not.toContain("<circle"); expect(hidden).not.toContain("下面 · 6");
    const visible = renderToStaticMarkup(createElement(DiceFaceInspection, { die, face, locale: "en", label: "Bottom" }));
    expect(visible.match(/<circle/g)).toHaveLength(6);
  });

  it("works on LAN HTTP without randomUUID or new scene identities", () => {
    vi.stubGlobal("crypto", {});
    try {
      const scene = createDiceScene(), moved = openDieFaces(scene.dice[0], ["z-"]);
      expect(isDiceFaceMoved(moved, "z-")).toBe(true); expect(moved.id).toBe(scene.dice[0].id);
    } finally { vi.unstubAllGlobals(); }
  });

  it("uses the same normal movement for all entries without capturing the camera or floating panels", () => {
    const source = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    const move = source.slice(source.indexOf("const openFaces ="), source.indexOf("const roll ="));
    expect(move).toContain("openDieFaces(die, faces)"); expect(move).toContain("850");
    expect(move).toContain("else openFaces(id, [face])"); expect(move).toContain("openFaces(selected.id, [pairFace, oppositeFace(pairFace)])");
    expect(move).not.toContain("setCameraKey"); expect(move).not.toContain("setFrame");
    expect(source).toContain("onSelect={setSelectedId}"); expect(source).toContain("<DiceFaceInspection"); expect(source).toContain("<CubeCanvasPanel");
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).not.toContain("getBoundingClientRect"); expect(canvas).not.toContain("observationRef");
    expect(canvas).toContain("diceFaceTranslation(die, face)"); expect(canvas).toContain("diceFaceCorners(die, face, false)");
    expect(canvas).toContain("<DiceXRayTransition");
    for (const name of ["dice-teaching-model.ts", "dice-teaching-display.ts", "DiceTeachingWorkspace.tsx", "DiceTeachingCanvas.tsx"]) {
      const code = readFileSync(`src/features/tools/spatial-lab/${name}`, "utf8");
      expect(code).not.toContain("faceShifts"); expect(code).not.toContain("dice-face-observation");
    }
  });
});
