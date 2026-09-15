import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { DICE_FACES, DICE_ORIENTATIONS, DICE_TEACHING_VERSION, FACE_NORMALS, PIP_POINTS, addFootprints, arrangeDice, canPlaceDie, contactVisibility, controlledRoll, createDiceScene, createDie, diceContacts, faceValue, footprint, interpolateDice, isGridDie, oppositeFace, quaternion, sampleControlledRoll, solveDicePuzzle, turnDie, vector, worldFace, worldNormal, type DiceHand, type RollDirection } from "@/features/tools/spatial-lab/dice-teaching-model";
import { diceFaceGeometries } from "@/features/tools/spatial-lab/dice-teaching-geometry";
import { diceTeachingMessages } from "@/features/tools/spatial-lab/dice-teaching-messages";
import { LOCAL_SPATIAL_WORKBENCH_SYNC_PROVIDERS } from "@/features/classroom/sync/interaction-audit";

describe("dice teaching model", () => {
  it("creates a mixed-handed local scene without secure-context UUID APIs", () => {
    vi.stubGlobal("crypto", { getRandomValues: undefined, randomUUID: undefined });
    try {
      const scene = createDiceScene();
      expect(scene.version).toBe(DICE_TEACHING_VERSION);
      expect(scene.dice.map((die) => die.hand)).toEqual(["right", "left"]);
      expect(new Set(scene.dice.map((die) => die.id)).size).toBe(2);
      expect(LOCAL_SPATIAL_WORKBENCH_SYNC_PROVIDERS[DICE_TEACHING_VERSION].mode).toBe("read-only");
    } finally { vi.unstubAllGlobals(); }
  });
  it("has 24 proper rotations, mirrored handedness, and all opposite sums equal seven", () => {
    expect(DICE_ORIENTATIONS).toHaveLength(24);
    for (const hand of ["left", "right"] as DiceHand[]) for (const rotation of DICE_ORIENTATIONS) {
      const die = { ...createDie("test", hand, { x: 0, y: 0.5, z: 0 }), rotation };
      const normals = [1, 2, 3].map((n) => worldNormal(die, DICE_FACES.find((face) => faceValue(hand, face) === n)!));
      expect(Math.round(normals[0].dot(normals[1].clone().cross(normals[2])))).toBe(hand === "right" ? 1 : -1);
      for (const face of DICE_FACES) expect(faceValue(hand, face) + faceValue(hand, oppositeFace(face))).toBe(7);
      expect(new Set(DICE_FACES.map((direction) => worldFace(die, direction))).size).toBe(6);
    }
  });
  it.each(["x+", "x-", "z+", "z-"] as RollDirection[])("rolls continuously around the bottom edge in %s", (direction) => {
    const die = createDie("test", "right", { x: 0, y: 0.5, z: 0 });
    const d = FACE_NORMALS[direction];
    const half = sampleControlledRoll(die, direction, 0.5);
    expect(half.position.y).toBeCloseTo(Math.SQRT1_2);
    const final = sampleControlledRoll(die, direction, 1);
    expect(final.position.x).toBeCloseTo(d.x); expect(final.position.z).toBeCloseTo(d.z); expect(final.position.y).toBeCloseTo(0.5);
    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      const frame = sampleControlledRoll(die, direction, progress);
      const heights = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => new Vector3(x, y, z).applyQuaternion(quaternion(frame.rotation)).add(vector(frame.position)).y)));
      expect(Math.min(...heights)).toBeCloseTo(0);
    }
    let next = die;
    for (let i = 0; i < 4; i++) next = sampleControlledRoll(next, direction, 1);
    expect(Math.abs(quaternion(next.rotation).dot(quaternion(die.rotation)))).toBeCloseTo(1);
  });
  it("records actual bottom pips, preserves hidden faces, and rolls back as a single snapshot", () => {
    const scene = createDiceScene();
    scene.dice = [{ ...createDie("dice-1", "left", { x: 0, y: 0.5, z: 0 }), hidden: ["x+", "y-"] }];
    const next = controlledRoll(scene, "dice-1", "z+", true)!;
    expect(scene.trail).toHaveLength(0); expect(next.trail).toHaveLength(2);
    expect(next.dice[0].hidden).toEqual(scene.dice[0].hidden);
    expect(next.trail[0].value).toBe(6);
    expect(next.trail[1].value).toBe(faceValue("left", worldFace(next.dice[0], "y-")!));
    for (const stamp of next.trail) { expect(stamp.points).toHaveLength(stamp.value); expect(stamp.points.every((p) => p.y > 0 && Math.abs(p.x - stamp.x) < 0.5 && Math.abs(p.z - stamp.z) < 0.5)).toBe(true); }
    expect(controlledRoll(scene, "dice-1", "z+", false)!.trail).toHaveLength(0);
  });
  it("rejects blocked paths, stacks above a rolling die, expanded faces, and non-grid poses", () => {
    const scene = createDiceScene(); scene.dice = [createDie("a", "right", { x: 0, y: 0.5, z: 0 }), createDie("b", "left", { x: 1, y: 0.5, z: 0 })];
    expect(controlledRoll(scene, "a", "x+", true)).toBeNull();
    scene.dice[1].position = { x: 0, y: 1.5, z: 0 };
    expect(controlledRoll(scene, "a", "x+", true)).toBeNull();
    scene.dice = [{ ...scene.dice[0], offsets: { "z+": 1 } }];
    expect(controlledRoll(scene, "a", "z-", true)).toBeNull();
    scene.dice = [{ ...scene.dice[0], offsets: {}, position: { x: 0.2, y: 0.5, z: 0 } }];
    expect(isGridDie(scene.dice[0])).toBe(false);
    expect(controlledRoll(scene, "a", "z-", true)).toBeNull();
    expect(canPlaceDie(scene.dice, "a", { x: 6, y: 0.5, z: 0 })).toBe(false);
  });
  it("keeps footprints bounded and replaces a revisited cell", () => {
    const die = createDie("a", "right", { x: 0, y: 0.5, z: 0 });
    const stamps = addFootprints([], Array.from({ length: 160 }, (_, x) => ({ ...die, position: { ...die.position, x } })));
    expect(stamps).toHaveLength(128);
    expect(addFootprints([footprint(die)!], [turnDie(die, "x")])).toHaveLength(1);
  });
  it("detects touching faces in rows and stacks after independent rotations", () => {
    const dice = arrangeDice(createDiceScene().dice, "row").map((die, i) => turnDie(die, i ? "z" : "x"));
    expect(diceContacts(dice)).toHaveLength(1);
    const hidden = contactVisibility(dice, true);
    expect(hidden.every((die) => die.hidden.length === 1)).toBe(true);
    expect(contactVisibility(hidden, false).every((die) => !die.hidden.length)).toBe(true);
    expect(diceContacts(arrangeDice(dice, "stack"))[0].direction).toBe("y+");
    expect(diceContacts(arrangeDice(dice, "apart"))).toHaveLength(0);
  });
  it("solves touching-pair and total constraints, preserving mixed hands", () => {
    const dice = arrangeDice(Array.from({ length: 4 }, (_, i) => createDie(String(i), i % 2 ? "left" : "right", { x: i, y: 0.5, z: 0 })), "row");
    for (const scope of ["each", "total"] as const) {
      const target = scope === "each" ? 7 : 21;
      const result = solveDicePuzzle(dice, scope, target, () => 0.25);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const sums = diceContacts(result.dice).map((c) => c.valueA + c.valueB);
      expect(scope === "each" ? sums.every((sum) => sum === 7) : sums.reduce((a, b) => a + b, 0) === 21).toBe(true);
      expect(result.dice.map((die) => die.hand)).toEqual(dice.map((die) => die.hand));
      for (const c of diceContacts(result.dice)) { expect(result.dice.find((die) => die.id === c.a)!.hidden).toContain(c.faceA); expect(result.dice.find((die) => die.id === c.b)!.hidden).toContain(c.faceB); }
    }
    expect(solveDicePuzzle(dice, "total", 2)).toEqual({ ok: false, reason: "impossible" });
    expect(solveDicePuzzle(dice, "each", 2)).toEqual({ ok: false, reason: "impossible" });
    expect(solveDicePuzzle(createDiceScene().dice, "total", 7)).toEqual({ ok: false, reason: "no-contacts" });
  });
  it("samples face displacement and body motion without committing intermediate state", () => {
    const from = createDiceScene().dice, to = from.map((die) => ({ ...turnDie(die, "x"), offsets: { "x+": 1.1 } }));
    const half = interpolateDice(from, to, 0.5);
    expect(half[0].offsets["x+"]).toBeCloseTo(0.55);
    expect(from[0].offsets).toEqual({});
    expect(Math.abs(quaternion(half[0].rotation).dot(quaternion(from[0].rotation)))).toBeLessThan(1);
  });
  it("assembles six rounded white face patches and matching bilingual controls", () => {
    const faces = diceFaceGeometries(); expect(faces).toHaveLength(6);
    faces.forEach((face, index) => {
      const position = face.getAttribute("position"); expect(position.count).toBeGreaterThan(20);
      const center = new Vector3(); for (let i = 0; i < position.count; i++) center.add(new Vector3().fromBufferAttribute(position, i));
      expect(center.normalize().dot(vector(FACE_NORMALS[DICE_FACES[index]]))).toBeCloseTo(1);
      face.dispose();
    });
    for (let n = 0; n <= 6; n++) expect(PIP_POINTS[n]).toHaveLength(n);
    expect(Object.keys(diceTeachingMessages("en")).sort()).toEqual(Object.keys(diceTeachingMessages("zh")).sort());
    const workspace = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    expect(workspace).toContain('import("./dice-physics")');
    expect(workspace).toContain('essential: true');
    expect(workspace).not.toContain("Dialog");
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain('color="#ffffff"');
    expect(canvas).toContain('side={FrontSide}');
    expect(canvas).not.toContain("minPolarAngle");
    expect(canvas).not.toContain("maxPolarAngle");
  });
});
