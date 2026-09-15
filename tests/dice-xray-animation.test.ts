import { readFileSync } from "node:fs";
import { Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";
import { DICE_XRAY_DURATION_MS, applyDiceXRayOpacity, diceXRayOpacity, diceXRayPresentation, sameDiceXRayTarget, stepDiceXRayMotion, type DiceXRayMotion } from "@/features/tools/spatial-lab/dice-xray-animation";
import { DICE_XRAY_SURFACE, diceXRayPick, nextDiceXRayTarget } from "@/features/tools/spatial-lab/dice-xray-observation";

const first = { id: "dice-1", face: "z-" as const }, second = { id: "dice-2", face: "x-" as const }, third = { id: "dice-2", face: "y-" as const };
const closed: DiceXRayMotion = { target: null, progress: 0 };

describe("dice X-ray teaching transitions", () => {
  it("starts at zero, advances through visible intermediate frames and reaches the stable observation", () => {
    let motion = stepDiceXRayMotion(closed, first, 50);
    expect(motion).toEqual({ target: first, progress: 0 });
    expect(diceXRayPresentation(motion, first).phase).toBe("opening");
    motion = stepDiceXRayMotion(motion, first, DICE_XRAY_DURATION_MS / 3);
    expect(motion.progress).toBeCloseTo(1 / 3);
    motion = stepDiceXRayMotion(motion, first, DICE_XRAY_DURATION_MS / 3);
    expect(motion.progress).toBeCloseTo(2 / 3);
    motion = stepDiceXRayMotion(motion, first, DICE_XRAY_DURATION_MS / 3);
    expect(motion.progress).toBe(1); expect(diceXRayPresentation(motion, first).phase).toBe("open");
    expect(stepDiceXRayMotion(motion, first, 10000)).toEqual(motion);
  });

  it("keeps the displayed face mounted throughout restoration and removes it only at zero", () => {
    const full = { target: first, progress: 1 };
    const halfway = stepDiceXRayMotion(full, null, DICE_XRAY_DURATION_MS / 2);
    expect(halfway).toEqual({ target: first, progress: 0.5 });
    expect(diceXRayPresentation(halfway, null)).toEqual({ target: first, phase: "closing" });
    expect(stepDiceXRayMotion(halfway, null, DICE_XRAY_DURATION_MS / 2)).toEqual(closed);
    expect(diceXRayPresentation(closed, null).phase).toBe("closed");
  });

  it("reverses an interrupted transition from the current progress without resetting or jumping", () => {
    const opening = { target: first, progress: 0.7 };
    const reversing = stepDiceXRayMotion(opening, null, 90);
    expect(reversing.progress).toBeCloseTo(0.6);
    const resumed = stepDiceXRayMotion(reversing, first, 90);
    expect(resumed.progress).toBeCloseTo(opening.progress);
    expect(diceXRayOpacity(resumed.progress, 0.35)).toEqual(diceXRayOpacity(opening.progress, 0.35));
  });

  it("restores the old location first, then opens only the latest requested target", () => {
    const changing = stepDiceXRayMotion({ target: first, progress: 1 }, second, 450);
    expect(changing).toEqual({ target: first, progress: 0.5 });
    expect(diceXRayPresentation(changing, second)).toEqual({ target: first, phase: "closing" });
    const latest = stepDiceXRayMotion(changing, third, 450);
    expect(latest).toEqual({ target: third, progress: 0 });
    expect(diceXRayPresentation(latest, third)).toEqual({ target: third, phase: "opening" });
    expect(stepDiceXRayMotion(latest, third, 450).progress).toBe(0.5);
    expect(sameDiceXRayTarget(latest.target, second)).toBe(false);
  });

  it("separates foreground and target pips on both paths while retaining the original target opacity", () => {
    expect(diceXRayOpacity(0, 0.35)).toEqual({ window: 0, face: 0, outline: 0, occluder: 0 });
    expect(diceXRayOpacity(1, 0.35)).toEqual({ window: 1, face: 0.35, outline: 0.95, occluder: 0.22 });
    let previousWindow = 0, previousFace = 0;
    for (let step = 0; step <= 100; step++) {
      const opacity = diceXRayOpacity(step / 100, 0.35);
      expect(opacity.window).toBeGreaterThanOrEqual(previousWindow); expect(opacity.face).toBeGreaterThanOrEqual(previousFace);
      expect((1 - opacity.window) * opacity.face).toBe(0);
      expect(opacity.face).toBeLessThanOrEqual(0.35);
      expect(diceXRayOpacity(step / 100, 0).face).toBe(0);
      previousWindow = opacity.window; previousFace = opacity.face;
    }
    expect(diceXRayOpacity(0.3, 1).window).toBeCloseTo(0.5);
    expect(diceXRayOpacity(0.3, 1).face).toBe(0);
    expect(diceXRayOpacity(0.8, 1).window).toBe(1);
    expect(diceXRayOpacity(0.8, 1).face).toBeCloseTo(0.5);
  });

  it("updates only temporary named materials and keeps the target texture and scene materials intact", () => {
    const root = new Group(), map = new Texture(), original = new MeshBasicMaterial({ opacity: 0.35, map });
    const materials = ["window", "face", "outline", "occluder"].map((name) => { const material = original.clone(); material.name = `dice-xray-${name}`; root.add(new Mesh(undefined, material)); return material; });
    const untouched = original.clone(); root.add(new Mesh(undefined, untouched));
    applyDiceXRayOpacity(root, 0.3, original.opacity);
    expect(materials.map((material) => material.opacity)).toEqual([0.5, 0, 0.95, 0.11]);
    applyDiceXRayOpacity(root, 1, original.opacity);
    expect(materials.map((material) => material.opacity)).toEqual([1, 0.35, 0.95, 0.22]);
    expect(materials[1].map).toBe(map); expect(original.opacity).toBe(0.35); expect(untouched.opacity).toBe(0.35);
    root.children.forEach((object) => (object as Mesh).geometry.dispose()); materials.forEach((material) => material.dispose()); untouched.dispose(); original.dispose(); map.dispose();
  });

  it("can reopen the still-visible target during closing without selecting its opposite by mistake", () => {
    const clicked = { id: "dice-2", face: "z+" as const };
    const hit = { object: { name: DICE_XRAY_SURFACE, userData: { diceXRayId: first.id, diceXRayFace: first.face } } };
    const picked = diceXRayPick(null, clicked, [hit]);
    expect(nextDiceXRayTarget(null, picked)).toEqual(first);
    expect(nextDiceXRayTarget(first, diceXRayPick(first, clicked, [hit]))).toBeNull();
  });

  it("retains the transition on clear and tool changes, reports the visible target, and leaves orbit unlocked", () => {
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain("<DiceXRayTransition dice={dice}"); expect(canvas).not.toContain("{xray && <DiceXRay");
    expect(canvas).toContain('interactive={props.tool === "xray" && !props.busy}');
    expect(canvas).toContain("axisSnapEnabled={props.snap} interactive navigationMode=");
    const transition = readFileSync("src/features/tools/spatial-lab/DiceXRayTransition.tsx", "utf8");
    expect(transition).toContain("Math.min(delta * 1000, 50)"); expect(transition).toContain("applyDiceXRayOpacity(group.current");
    expect(transition).toContain('presentation.phase === "opening" || presentation.phase === "closing"');
    expect(transition).not.toContain("prefers-reduced-motion"); expect(transition).not.toContain("setHistory");
    const workspace = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    expect(workspace).toContain("diceXRayDisplay(displayed, xrayPresentation.target)");
  });
});
