import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseClassroomInputCapability,
  resolveClassroomInputCapabilityFromPath,
  resolveClassroomRendererInputProfile,
} from "@/features/classroom/input/capabilities";
import {
  classroomInputProviderAttributes,
  isClassroomInputCapabilityProvider,
} from "@/features/classroom/input/provider";
import { createM3DocumentInputFixture } from "@/features/classroom/live/m3-input-fixtures";
import { games } from "@/features/games/registry";
import { tools } from "@/features/tools/registry";
import {
  CLASSROOM_SMART_TAKEOVER_PX,
  IDLE_CLASSROOM_INPUT_STATE,
  isClassroomInkTakeover,
  reduceClassroomInputRouter,
  resolveClassroomRoutingMode,
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

function attributeNode(attributes: Record<string, string | number | undefined>) {
  return {
    getAttribute(name: string) {
      const value = attributes[name];
      return value === undefined ? null : String(value);
    },
  };
}

describe("M3a classroom input routing", () => {
  it("derives both fallback locks from the active tool behind one Smart toggle", () => {
    expect(resolveClassroomRoutingMode({
      smartEnabled: true,
      smartAvailable: true,
      tool: "drawing",
    })).toBe("smart");
    expect(resolveClassroomRoutingMode({
      smartEnabled: false,
      smartAvailable: true,
      tool: "pointer",
    })).toBe("interaction-lock");
    expect(resolveClassroomRoutingMode({
      smartEnabled: false,
      smartAvailable: true,
      tool: "drawing",
    })).toBe("ink-lock");
    expect(resolveClassroomRoutingMode({
      smartEnabled: true,
      smartAvailable: false,
      tool: "pointer",
    })).toBe("interaction-lock");
    expect(resolveClassroomRoutingMode({
      smartEnabled: true,
      smartAvailable: false,
      tool: "drawing",
    })).toBe("ink-lock");
  });

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

  it("resolves every registry declaration through one provider conformance gate", () => {
    for (const game of games) {
      const profile = resolveClassroomRendererInputProfile({ ...sudokuPage, gameId: game.id }, null);
      expect(profile.audited).toBe(Boolean(game.classroomInput));
      if (game.classroomInput) {
        expect(isClassroomInputCapabilityProvider(game.classroomInput)).toBe(true);
        expect(profile).toMatchObject({
          renderer: game.id,
          provider: game.classroomInput,
        });
      }
    }
    for (const tool of tools) {
      const profile = resolveClassroomRendererInputProfile(sudokuPage, tool.id);
      expect(profile.audited).toBe(Boolean(tool.classroomInput));
      if (tool.classroomInput) {
        expect(isClassroomInputCapabilityProvider(tool.classroomInput)).toBe(true);
        expect(profile).toMatchObject({
          renderer: `tool:${tool.id}`,
          provider: tool.classroomInput,
        });
      }
    }
    const unknownGame = resolveClassroomRendererInputProfile({ ...sudokuPage, gameId: "unregistered-game" }, null);
    const unknownTool = resolveClassroomRendererInputProfile(sudokuPage, "future-tool");
    expect(unknownGame).toMatchObject({ renderer: "unsupported", audited: false, provider: null });
    expect(unknownTool).toMatchObject({ renderer: "unsupported", audited: false, provider: null });
    expect(parseClassroomInputCapability("click", unknownGame)).toBe("unknown");
  });

  it("trusts capability markers only inside a matching provider boundary", () => {
    const profile = resolveClassroomRendererInputProfile(sudokuPage, null);
    const boundaryAttributes = classroomInputProviderAttributes(profile.renderer, profile.provider);
    const clickTarget = attributeNode({ "data-classroom-input": "click" });
    const boundary = attributeNode(boundaryAttributes);
    expect(resolveClassroomInputCapabilityFromPath([clickTarget, boundary], profile)).toEqual({
      capability: "click",
      owner: clickTarget,
    });
    expect(resolveClassroomInputCapabilityFromPath([attributeNode({}), boundary], profile).capability).toBe("ink");
    expect(resolveClassroomInputCapabilityFromPath([clickTarget], profile).capability).toBe("unknown");
    expect(resolveClassroomInputCapabilityFromPath([
      clickTarget,
      attributeNode({ ...boundaryAttributes, "data-classroom-renderer-version": 2 }),
    ], profile).capability).toBe("unknown");

    const partitioned = resolveClassroomRendererInputProfile(sudokuPage, "fraction-line");
    const partitionedBoundary = attributeNode(
      classroomInputProviderAttributes(partitioned.renderer, partitioned.provider),
    );
    expect(resolveClassroomInputCapabilityFromPath([attributeNode({}), partitionedBoundary], partitioned).capability)
      .toBe("unknown");
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

  it("anchors each v1 primitive in representative DOM providers without synthetic clicks", () => {
    const sudoku = readFileSync(new URL("../src/features/games/sudoku/SudokuBoard.tsx", import.meta.url), "utf8");
    const docStage = readFileSync(new URL("../src/features/courseware-doc/DocStage.tsx", import.meta.url), "utf8");
    const videoStage = readFileSync(new URL("../src/features/classroom/live/VideoStage.tsx", import.meta.url), "utf8");
    const videoSurface = readFileSync(new URL("../src/features/classroom/input/ClassroomVideoInkSurface.tsx", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("../src/features/whiteboard/CanvasSurface.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("../src/features/classroom/input/useClassroomPointerRouter.ts", import.meta.url), "utf8");
    const panels = readFileSync(new URL("../src/features/classroom/live/LivePanels.tsx", import.meta.url), "utf8");
    const liveShell = readFileSync(new URL("../src/features/classroom/live/LiveShell.tsx", import.meta.url), "utf8");
    const controlBar = readFileSync(new URL("../src/features/classroom/live/TeacherClassroomControlBar.tsx", import.meta.url), "utf8");
    const fractionLine = readFileSync(new URL("../src/features/tools/fraction-line/FractionLine.tsx", import.meta.url), "utf8");
    const capabilities = readFileSync(new URL("../src/features/classroom/input/capabilities.ts", import.meta.url), "utf8");
    const gameRegistry = readFileSync(new URL("../src/features/games/registry.ts", import.meta.url), "utf8");
    const toolRegistry = readFileSync(new URL("../src/features/tools/registry.ts", import.meta.url), "utf8");
    const liveRoute = readFileSync(new URL("../src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx", import.meta.url), "utf8");
    expect(sudoku).toContain('data-classroom-input="click"');
    expect(sudoku).toContain('data-classroom-input={state.highlightTool === "cell" ? "drag" : "click"}');
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
    expect(panels).toContain("classroomInputProviderAttributes");
    expect(liveShell).toContain('foreground={Boolean(activeToolId) && rendererProfile.audited}');
    expect(liveShell).toContain("classroomInputProviderAttributes(rendererProfile.renderer, rendererProfile.provider)");
    expect(liveShell).toContain("<TeacherClassroomControlBar");
    expect(controlBar).toContain('className="fixed inset-x-0 bottom-0');
    expect(controlBar).toContain('data-classroom-control-surface="flat-rail"');
    expect(fractionLine).toContain('data-classroom-input="click"');
    expect(fractionLine).toContain('data-classroom-input="drag"');
    expect(fractionLine).toContain('data-classroom-input="ink"');
    expect(fractionLine).toContain('data-classroom-input="native"');
    expect(capabilities).not.toContain("AUDITED_CLASSROOM_NATIVE_GAME_IDS");
    expect(capabilities).not.toContain("AUDITED_CLASSROOM_TOOL_IDS");
    expect(gameRegistry).toContain("classroomInput: CLASSROOM_INK_INPUT_PROVIDER_V1");
    expect(toolRegistry).toContain("classroomInput: CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1");
    expect(liveRoute).toContain('isFeatureEnabled("teaching.classroom_input_v2")');
  });
});
