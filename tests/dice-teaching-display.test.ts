import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BoxGeometry, Color, Euler, GridHelper, Mesh, MeshBasicMaterial, OrthographicCamera, Raycaster, Vector2, Vector3 } from "three";
import { DICE_FACES, DICE_ORIENTATIONS, createDiceScene, diceContacts, faceValue, sampleControlledRoll, turnDie } from "@/features/tools/spatial-lab/dice-teaching-model";
import { DICE_BLACK_PIPS, DICE_RED_PIPS, DICE_TABLE_COLOR, DICE_TABLE_RENDERING, DICE_WHITE, closeDiceFaces, diceFaceArrows, dicePipShades, diceSelectionMarker, diceSurface, ignoreDiceHelperRaycast, restoreDiceScene, styleDiceFaces } from "@/features/tools/spatial-lab/dice-teaching-display";
import { diceTeachingMessages } from "@/features/tools/spatial-lab/dice-teaching-messages";

describe("dice display feedback", () => {
  it("draws the table and grid behind real faces without writing occluding depth", () => {
    expect(DICE_TABLE_RENDERING.renderOrder).toBeLessThan(0); expect(DICE_TABLE_RENDERING.depthWrite).toBe(false);
    const source = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(source.match(/depthWrite=\{DICE_TABLE_RENDERING.depthWrite\}/g)).toHaveLength(3);
    expect(source.match(/renderOrder=\{DICE_TABLE_RENDERING.renderOrder\}/g)).toHaveLength(3);
    expect(source).toContain('renderOrder={DICE_TABLE_RENDERING.renderOrder + 1} material-depthWrite={false}');
    expect(source).toContain('depthWrite={surface.opacity >= 0.99}');
  });
  it("uses a darker table color distinct from white dice and the supported PCF shadow mode", () => {
    const luminance = (value: string) => { const color = new Color(value); return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722; };
    expect((luminance(DICE_WHITE) + 0.05) / (luminance(DICE_TABLE_COLOR) + 0.05)).toBeGreaterThan(4.5);
    const source = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(source).toContain('shadows={THREE_SHADOWS.filtered}'); expect(source).not.toContain("PCFSoftShadowMap");
  });
  it("only builds all six arrows for the selected die and preserves other moved faces", () => {
    const scene = createDiceScene();
    scene.dice[0].offsets = { "z+": 1.1 }; scene.dice[1].offsets = { "x-": 1.1 };
    const snapshot = JSON.stringify(scene);
    for (const selected of scene.dice) {
      const arrows = diceFaceArrows(scene.dice, selected.id, (die, face) => `${die.id}/${face}`);
      expect(arrows).toHaveLength(6); expect(arrows.every((arrow) => arrow.dieId === selected.id)).toBe(true);
      expect(new Set(arrows.map((arrow) => arrow.face)).size).toBe(6);
      for (const arrow of arrows) {
        expect(arrow.center.distanceTo(new Vector3(selected.position.x, selected.position.y, selected.position.z))).toBeCloseTo(0.5 + (selected.offsets[arrow.face] ?? 0));
        expect(arrow.position.clone().sub(arrow.center).dot(arrow.normal)).toBeCloseTo(0.9);
        expect(arrow.expanded).toBe((selected.offsets[arrow.face] ?? 0) > 0);
      }
    }
    expect(JSON.stringify(scene)).toBe(snapshot);
  });
  it("regresses false grid occlusion while keeping real cube occlusion", () => {
    const camera = new OrthographicCamera(-4.4, 4.4, 3.3, -3.3, 0.1, 100);
    camera.position.set(13.2, 11.06, 13.2); camera.lookAt(0, 0.5, 0); camera.updateMatrixWorld();
    const grid = new GridHelper(12, 12); grid.position.y = 0.003; grid.updateMatrixWorld();
    const ray = new Raycaster(), point = new Vector3(-1, 0.5, 1.4), screen = point.clone().project(camera);
    ray.setFromCamera(new Vector2(screen.x, screen.y), camera);
    expect(ray.intersectObject(grid)[0].distance).toBeLessThan(point.distanceTo(ray.ray.origin));
    grid.raycast = ignoreDiceHelperRaycast;
    expect(ray.intersectObject(grid)).toEqual([]);
    const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()); body.position.set(-1, 0.5, 0); body.updateMatrixWorld();
    const front = ray.intersectObject(body);
    expect(!front.length || front[0].distance > point.distanceTo(ray.ray.origin)).toBe(true);
    const back = new Vector3(-1, 0.5, -0.7), backScreen = back.clone().project(camera);
    ray.setFromCamera(new Vector2(backScreen.x, backScreen.y), camera);
    expect(ray.intersectObject(body)[0].distance).toBeLessThan(back.distanceTo(ray.ray.origin));
    body.geometry.dispose(); body.material.dispose(); grid.geometry.dispose();
    (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => material.dispose());
  });
  it("keeps the selection ring horizontal on X–Z at every rotation and rolling frame", () => {
    const die = createDiceScene().dice[0];
    const original = diceSelectionMarker(die.position);
    for (const rotation of DICE_ORIENTATIONS) {
      const changed = { ...die, rotation };
      expect(diceSelectionMarker(changed.position)).toEqual(original);
    }
    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      const frame = sampleControlledRoll(die, "z+", progress), marker = diceSelectionMarker(frame.position);
      expect(marker.position).toEqual([frame.position.x, 0.006, frame.position.z]);
      const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...marker.rotation));
      expect(normal.y).toBeCloseTo(1); expect(normal.x).toBeCloseTo(0); expect(normal.z).toBeCloseTo(0);
    }
  });
  it("uses red for 1 and 4 on either handed die, independent of face paint", () => {
    for (const die of createDiceScene().dice) for (const face of DICE_FACES) {
      const value = faceValue(die.hand, face);
      expect(dicePipShades(value)).toEqual(value === 1 || value === 4 ? DICE_RED_PIPS : DICE_BLACK_PIPS);
    }
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain('ctx.fillStyle = bump ? "#eeeeee" : color');
    expect(canvas).toContain('const shades = dicePipShades(value)');
    expect(canvas).toContain('color="#ffffff" map={texture.map}');
  });
  it("styles faces independently and preserves style through turns, moves and masks", () => {
    const scene = createDiceScene(), id = scene.dice[0].id;
    const colored = styleDiceFaces(scene.dice, id, ["z+"], { color: "#df8a84" });
    const translucent = styleDiceFaces(colored, id, ["z+"], { opacity: 0.35 });
    const transformed = { ...turnDie(translucent[0], "x"), offsets: { "z+": 1.1 }, hidden: ["z+" as const] };
    expect(diceSurface(transformed, "z+")).toEqual({ color: "#df8a84", opacity: 0.35 });
    expect(diceSurface(transformed, "x+")).toEqual({ color: "#ffffff", opacity: 1 });
    expect(translucent[1]).toBe(scene.dice[1]); expect(scene.dice[0].surfaces).toBeUndefined();
    const transparent = styleDiceFaces(translucent, id, DICE_FACES, { opacity: 0 });
    expect(DICE_FACES.every((face) => diceSurface(transparent[0], face).opacity === 0)).toBe(true);
    expect(diceSurface(styleDiceFaces(transparent, id, ["z+"], { color: undefined })[0], "z+")).toEqual({ color: "#ffffff", opacity: 0 });
    expect(diceContacts(translucent)).toEqual(diceContacts(scene.dice));
  });
  it("separates closing displaced faces from whole-scene restoration", () => {
    const scene = createDiceScene();
    scene.dice = styleDiceFaces(scene.dice.map((die) => ({ ...turnDie(die, "x"), hidden: ["x+" as const], offsets: { "x-": 1.1 } })), scene.dice[0].id, ["y+"], { color: "#7da9ce", opacity: 0.3 });
    scene.puzzle = { scope: "each", target: 7, revealed: false };
    scene.trail = [{ x: 0, z: 0, value: 1, points: [{ x: 0, y: 0.008, z: 0 }] }];
    const snapshot = JSON.stringify(scene), closed = closeDiceFaces(scene);
    expect(closed.trail).toBe(scene.trail); expect(closed.puzzle).toBe(scene.puzzle);
    closed.dice.forEach((die, i) => { expect(die.offsets).toEqual({}); expect(die.rotation).toEqual(scene.dice[i].rotation); expect(die.position).toEqual(scene.dice[i].position); expect(die.surfaces).toEqual(scene.dice[i].surfaces); expect(die.hidden).toEqual(scene.dice[i].hidden); });
    const restored = restoreDiceScene(scene);
    expect(restored.dice.map((die) => [die.id, die.hand])).toEqual(scene.dice.map((die) => [die.id, die.hand]));
    expect(restored.nextId).toBe(scene.nextId); expect(restored.trail).toEqual([]); expect(restored.puzzle).toBeNull();
    restored.dice.forEach((die) => { expect(die.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 }); expect(die.hidden).toEqual([]); expect(die.offsets).toEqual({}); expect(die.surfaces).toEqual({}); });
    expect(JSON.stringify(scene)).toBe(snapshot);
  });
  it("reuses existing controls/icons and keeps selection outside the scene mutation path", () => {
    const source = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    for (const shared of ["<SpatialColorPicker", "<SpatialOpacitySlider", 'action="faceReveal"', 'action="move"', 'action="settings"', 'action="faceColor"', 'action="opacity"', "<SpatialViewButtons views={SPATIAL_ALL_VIEWS}", "onSelect={setSelectedId}"]) expect(source).toContain(shared);
    const toggle = source.slice(source.indexOf("const toggleArrows ="), source.indexOf("const roll ="));
    expect(toggle).not.toContain("animate("); expect(toggle).not.toContain("closeDiceFaces");
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain("occlude={occluders}"); expect(canvas).toContain("opacity >= 0.99");
    expect(canvas).toContain("key={occlusionKey}");
    expect(canvas).toContain("...diceSelectionMarker(");
    expect(Object.keys(diceTeachingMessages("en"))).toEqual(Object.keys(diceTeachingMessages("zh")));
  });
});
