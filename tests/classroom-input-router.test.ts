import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseClassroomInputCapability,
  resolveClassroomRendererInputProfile,
} from "@/features/classroom/input/capabilities";
import { createM3DocumentInputFixture } from "@/features/classroom/live/m3-input-fixtures";
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

const documentPage = {
  id: "document-page",
  type: "doc" as const,
  docId: "document-doc",
  title: "Document",
};

const documentFixture = createM3DocumentInputFixture({
  title: "Document",
  instruction: "Tap",
  result: "Advanced",
});

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

  it("trusts each versioned in-repo native game and fails closed for unknown renderers", () => {
    for (const gameId of ["sudoku", "kakuro", "magic-square"] as const) {
      const profile = resolveClassroomRendererInputProfile({ ...sudokuPage, gameId }, null);
      expect(profile).toMatchObject({ renderer: gameId, version: 1, audited: true, defaultCapability: "ink" });
      expect(parseClassroomInputCapability("click", profile)).toBe("click");
      expect(parseClassroomInputCapability("drag", profile)).toBe("drag");
      expect(parseClassroomInputCapability("surprise", profile)).toBe("unknown");
    }
    const unknown = resolveClassroomRendererInputProfile({ ...sudokuPage, gameId: "unregistered-game" }, null);
    expect(unknown).toMatchObject({ renderer: "unsupported", audited: false, defaultCapability: "unknown" });
    expect(parseClassroomInputCapability("click", unknown)).toBe("unknown");
    expect(resolveClassroomRendererInputProfile(sudokuPage, "spatial-lab").audited).toBe(false);
  });

  it("audits only the partitioned Fraction Line overlay and protects other tools", () => {
    const fractionLine = resolveClassroomRendererInputProfile(sudokuPage, "fraction-line");
    expect(fractionLine).toMatchObject({
      renderer: "tool:fraction-line",
      version: 1,
      audited: true,
      defaultCapability: "unknown",
    });
    expect(parseClassroomInputCapability("click", fractionLine)).toBe("click");
    expect(parseClassroomInputCapability("drag", fractionLine)).toBe("drag");
    expect(parseClassroomInputCapability("ink", fractionLine)).toBe("ink");
    expect(parseClassroomInputCapability(null, fractionLine)).toBe("unknown");

    for (const toolId of ["motion-lab", "spatial-lab", "future-tool"]) {
      expect(resolveClassroomRendererInputProfile(sudokuPage, toolId)).toMatchObject({
        renderer: "unsupported",
        audited: false,
        defaultCapability: "unknown",
      });
    }
  });

  it("audits native video and plain documents while protecting unresolved and bridged docs", () => {
    const video = resolveClassroomRendererInputProfile({
      id: "video-page",
      type: "video",
      path: "lesson.mp4",
      title: "Video",
    }, null);
    expect(video).toMatchObject({ renderer: "video", audited: true, provisional: false });
    expect(parseClassroomInputCapability("click", video)).toBe("click");
    expect(parseClassroomInputCapability("native", video)).toBe("native");

    expect(resolveClassroomRendererInputProfile(documentPage, null)).toMatchObject({
      renderer: "unsupported",
      audited: false,
      provisional: true,
    });
    expect(resolveClassroomRendererInputProfile(documentPage, null, documentFixture)).toMatchObject({
      renderer: "document",
      audited: true,
      provisional: false,
    });

    const bridgedDocument = {
      ...documentFixture,
      nodes: documentFixture.nodes.map((node, index) => index === 0 ? { ...node, adapter: "h5" } : node),
    };
    expect(resolveClassroomRendererInputProfile(documentPage, null, bridgedDocument)).toMatchObject({
      renderer: "unsupported",
      audited: false,
      provisional: false,
    });

    const unknownDocument = {
      ...documentFixture,
      nodes: documentFixture.nodes.map((node, index) => index === 0
        ? { ...node, adapter: "future-native-widget" }
        : node),
    };
    expect(resolveClassroomRendererInputProfile(documentPage, null, unknownDocument)).toMatchObject({
      renderer: "unsupported",
      audited: false,
      provisional: false,
    });
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
    const kakuro = readFileSync(new URL("../src/features/games/kakuro/KakuroBoard.tsx", import.meta.url), "utf8");
    const magicSquare = readFileSync(new URL("../src/features/games/magic-square/MagicSquareBoard.tsx", import.meta.url), "utf8");
    const docStage = readFileSync(new URL("../src/features/courseware-doc/DocStage.tsx", import.meta.url), "utf8");
    const videoStage = readFileSync(new URL("../src/features/classroom/live/VideoStage.tsx", import.meta.url), "utf8");
    const videoSurface = readFileSync(new URL("../src/features/classroom/input/ClassroomVideoInkSurface.tsx", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("../src/features/whiteboard/CanvasSurface.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("../src/features/classroom/input/useClassroomPointerRouter.ts", import.meta.url), "utf8");
    const panels = readFileSync(new URL("../src/features/classroom/live/LivePanels.tsx", import.meta.url), "utf8");
    const liveShell = readFileSync(new URL("../src/features/classroom/live/LiveShell.tsx", import.meta.url), "utf8");
    const fractionLine = readFileSync(new URL("../src/features/tools/fraction-line/FractionLine.tsx", import.meta.url), "utf8");
    const liveRoute = readFileSync(new URL("../src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx", import.meta.url), "utf8");
    expect(sudoku).toContain('data-classroom-input="click"');
    expect(sudoku).toContain('data-classroom-input={state.highlightTool === "cell" ? "drag" : "click"}');
    for (const source of [kakuro, magicSquare]) {
      expect(source).toContain('data-cell-index={i}');
      expect((source.match(/<button/g) ?? []).length).toBe(
        (source.match(/data-classroom-input="click"/g) ?? []).length,
      );
    }
    expect(docStage).toContain('data-classroom-input={hasPageClick ? "click" : "ink"}');
    expect(docStage).toContain('data-classroom-input={clickTrigger ? "click" : undefined}');
    expect(docStage).toContain('data-classroom-input="native"');
    expect(videoStage).toContain('data-classroom-input="native"');
    expect(videoStage).toContain("<ClassroomVideoInkSurface");
    expect(docStage).toContain("<ClassroomVideoInkSurface");
    expect(videoSurface).toContain('data-classroom-input="click"');
    expect(videoSurface).toContain("bottom-14");
    expect(canvas).toContain('inputMode === "smart" && tool === "pen"');
    expect(hook).toContain("event.composedPath()");
    expect(hook).toContain('stage.style.webkitUserSelect = "none"');
    expect(hook).toContain('stage.style.setProperty("-webkit-touch-callout", "none")');
    expect(hook).toContain('stage.addEventListener("selectstart", preventTextSelection, true)');
    expect(hook).toContain("window.getSelection()?.removeAllRanges()");
    expect(hook).not.toMatch(/\.click\s*\(/);
    expect(panels).toContain('foreground ? "z-40" : "z-10"');
    expect(panels).toContain('data-classroom-input={auditedInput ? "ink" : undefined}');
    expect(liveShell).toContain('foreground={Boolean(activeToolId) && rendererProfile.audited}');
    expect(liveShell).toContain('bottom-3 left-1/2 z-50');
    expect(fractionLine).toContain('data-classroom-input="click"');
    expect(fractionLine).toContain('data-classroom-input="drag"');
    expect(fractionLine).toContain('data-classroom-input="ink"');
    expect(fractionLine).toContain('data-classroom-input="native"');
    expect(liveRoute).toContain('isFeatureEnabled("teaching.classroom_input_v2")');
  });
});
