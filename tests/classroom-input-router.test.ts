import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseClassroomInputCapability,
  resolveClassroomRendererInputProfile,
} from "@/features/classroom/input/capabilities";
import {
  CLASSROOM_SMART_TAKEOVER_PX,
  IDLE_CLASSROOM_INPUT_STATE,
  isClassroomInkTakeover,
  reduceClassroomInputRouter,
} from "@/features/classroom/input/router";

const sudokuPage = {
  id: "sudoku-page",
  type: "game" as const,
  gameId: "sudoku",
  difficulty: "medium" as const,
  seed: "input-router-fixture",
  title: "Sudoku",
};

describe("M3a classroom input routing", () => {
  it("routes pen, touch, and mouse identically", () => {
    for (const pointerType of ["pen", "touch", "mouse"]) {
      const pending = reduceClassroomInputRouter(IDLE_CLASSROOM_INPUT_STATE, {
        type: "pointer-down",
        pointerId: 7,
        pointerType,
        isPrimary: true,
        button: 0,
        mode: "smart",
        tool: "pen",
        capability: "click",
      });
      expect(pending).toEqual({ kind: "pending-click", pointerId: 7, maxMovementPx: 0 });
      expect(reduceClassroomInputRouter(pending, { type: "pointer-end", pointerId: 7 })).toEqual({ kind: "idle" });
    }
  });

  it("keeps a short click native and takes over at the frozen 8 CSS px threshold", () => {
    const pending = reduceClassroomInputRouter(IDLE_CLASSROOM_INPUT_STATE, {
      type: "pointer-down",
      pointerId: 3,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      mode: "smart",
      tool: "pen",
      capability: "click",
    });
    const short = reduceClassroomInputRouter(pending, {
      type: "pointer-move",
      pointerId: 3,
      maxMovementPx: CLASSROOM_SMART_TAKEOVER_PX - 0.1,
    });
    expect(short.kind).toBe("pending-click");
    const takeover = reduceClassroomInputRouter(short, {
      type: "pointer-move",
      pointerId: 3,
      maxMovementPx: CLASSROOM_SMART_TAKEOVER_PX,
    });
    expect(takeover).toEqual({ kind: "inking", pointerId: 3 });
    expect(isClassroomInkTakeover(short, takeover)).toBe(true);
  });

  it("honors locks, native drag ownership, invalid starts, and exact pointer endings", () => {
    const down = (mode: "smart" | "interaction-lock" | "ink-lock", capability: "click" | "drag" | "ink") =>
      reduceClassroomInputRouter(IDLE_CLASSROOM_INPUT_STATE, {
        type: "pointer-down",
        pointerId: 9,
        pointerType: "pen",
        isPrimary: true,
        button: 0,
        mode,
        tool: "pen",
        capability,
      });
    expect(down("interaction-lock", "ink").kind).toBe("native-interaction");
    expect(down("ink-lock", "click").kind).toBe("inking");
    expect(down("smart", "drag").kind).toBe("native-interaction");
    expect(down("smart", "ink").kind).toBe("inking");
    const inking = down("ink-lock", "click");
    expect(reduceClassroomInputRouter(inking, { type: "pointer-end", pointerId: 10 })).toBe(inking);
    expect(reduceClassroomInputRouter(inking, { type: "pointer-cancel", pointerId: 9 })).toEqual({ kind: "idle" });
    expect(reduceClassroomInputRouter(IDLE_CLASSROOM_INPUT_STATE, {
      type: "pointer-down",
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: false,
      button: 0,
      mode: "ink-lock",
      tool: "pen",
      capability: "ink",
    })).toBe(IDLE_CLASSROOM_INPUT_STATE);
  });

  it("fails closed for unknown renderers and only trusts the versioned Sudoku profile", () => {
    const sudoku = resolveClassroomRendererInputProfile(sudokuPage, false);
    expect(sudoku).toMatchObject({ renderer: "sudoku", version: 1, audited: true, defaultCapability: "ink" });
    expect(parseClassroomInputCapability("click", sudoku)).toBe("click");
    expect(parseClassroomInputCapability("drag", sudoku)).toBe("drag");
    expect(parseClassroomInputCapability("surprise", sudoku)).toBe("unknown");
    const unknown = resolveClassroomRendererInputProfile({ ...sudokuPage, gameId: "magic-square" }, false);
    expect(unknown).toMatchObject({ renderer: "unsupported", audited: false, defaultCapability: "unknown" });
    expect(parseClassroomInputCapability("click", unknown)).toBe("unknown");
    expect(resolveClassroomRendererInputProfile(sudokuPage, true).audited).toBe(false);
  });

  it("registers the production switch as a fail-closed database flag", () => {
    const migration = readFileSync(new URL("../supabase/migrations/20260824000200_classroom_input_v2_flag.sql", import.meta.url), "utf8");
    const contract = readFileSync(new URL("../src/features/school/organization-settings-contract.ts", import.meta.url), "utf8");
    expect(migration).toContain("'teaching.classroom_input_v2'");
    expect(migration).toMatch(/teaching\.classroom_input_v2', 1, false/);
    expect(contract).toContain('"teaching.classroom_input_v2"');
  });

  it("wires audited native capabilities without synthetic clicks", () => {
    const sudoku = readFileSync(new URL("../src/features/games/sudoku/SudokuBoard.tsx", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("../src/features/whiteboard/CanvasSurface.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("../src/features/classroom/input/useClassroomPointerRouter.ts", import.meta.url), "utf8");
    const liveRoute = readFileSync(new URL("../src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx", import.meta.url), "utf8");
    expect(sudoku).toContain('data-classroom-input="click"');
    expect(sudoku).toContain('data-classroom-input={state.highlightTool === "cell" ? "drag" : "click"}');
    expect(canvas).toContain('inputMode === "smart" && tool === "pen"');
    expect(hook).toContain("event.composedPath()");
    expect(hook).not.toMatch(/\.click\s*\(/);
    expect(liveRoute).toContain('isFeatureEnabled("teaching.classroom_input_v2")');
  });
});
