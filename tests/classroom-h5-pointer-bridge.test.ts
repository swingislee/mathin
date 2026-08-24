import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  H5_POINTER_FRAME_SOURCE,
  H5_POINTER_MAX_POINTS_PER_CHUNK,
  H5_POINTER_PROTOCOL_SCHEMA,
  H5_POINTER_PROTOCOL_VERSION,
  H5_POINTER_RUNTIME_VERSION,
  parseH5PointerFrameMessage,
} from "@/features/courseware-doc/h5-pointer-protocol";
import { H5_OPAQUE_ORIGIN_RUNTIME } from "@/features/courseware-doc/h5-shim";
import {
  countCoursewareH5Frames,
  resolveClassroomRendererInputProfile,
} from "@/features/classroom/input/capabilities";
import {
  M3_H5_FIXTURE_DOC,
  M3_H5_FIXTURE_PAGE,
} from "@/features/classroom/live/m3-input-fixtures";

const base = {
  source: H5_POINTER_FRAME_SOURCE,
  schema: H5_POINTER_PROTOCOL_SCHEMA,
  version: H5_POINTER_PROTOCOL_VERSION,
  frameId: "root/frame",
  channelToken: crypto.randomUUID(),
} as const;

describe("M3b H5 pointer bridge", () => {
  it("validates bounded handshake and pointer messages", () => {
    expect(parseH5PointerFrameMessage({
      ...base,
      type: "pointer_capabilities",
      providerSchema: "mathin-classroom-input",
      providerVersion: 1,
      defaultCapability: "ink",
    })).toMatchObject({ type: "pointer_capabilities", defaultCapability: "ink" });

    expect(parseH5PointerFrameMessage({
      ...base,
      type: "pointer_start",
      pointerId: 7,
      pointerType: "mouse",
      gestureToken: "gesture-7",
      capability: "click",
      isPrimary: true,
      button: 0,
      x: 0.25,
      y: 0.75,
    })).toMatchObject({ type: "pointer_start", capability: "click" });

    expect(parseH5PointerFrameMessage({
      ...base,
      type: "pointer_move",
      pointerId: 7,
      gestureToken: "gesture-7",
      chunkSeq: 1,
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    })).toMatchObject({ type: "pointer_move", chunkSeq: 1 });

    expect(parseH5PointerFrameMessage({ ...base, version: 2, type: "pointer_pong" })).toBeNull();
    expect(parseH5PointerFrameMessage({
      ...base,
      type: "pointer_move",
      pointerId: 7,
      gestureToken: "gesture-7",
      chunkSeq: 1,
      points: Array.from({ length: H5_POINTER_MAX_POINTS_PER_CHUNK + 1 }, () => ({ x: 0.5, y: 0.5 })),
    })).toBeNull();
    expect(parseH5PointerFrameMessage({
      ...base,
      type: "pointer_end",
      pointerId: 7,
      gestureToken: "gesture-7",
      chunkSeq: 2,
      points: [{ x: Number.NaN, y: 0.5 }],
    })).toBeNull();
  });

  it("keeps H5 provisional through the handshake and fails closed on incompatibility", () => {
    expect(countCoursewareH5Frames(M3_H5_FIXTURE_DOC)).toBe(1);
    expect(resolveClassroomRendererInputProfile(
      M3_H5_FIXTURE_PAGE,
      null,
      M3_H5_FIXTURE_DOC,
      "pending",
    )).toMatchObject({ audited: false, provisional: true, provider: null });
    expect(resolveClassroomRendererInputProfile(
      M3_H5_FIXTURE_PAGE,
      null,
      M3_H5_FIXTURE_DOC,
      "ready",
    )).toMatchObject({ renderer: "document:h5", audited: true, provisional: false });
    for (const status of ["disabled", "incompatible", "timeout"] as const) {
      expect(resolveClassroomRendererInputProfile(
        M3_H5_FIXTURE_PAGE,
        null,
        M3_H5_FIXTURE_DOC,
        status,
      )).toMatchObject({ renderer: "unsupported", audited: false, provisional: false });
    }
  });

  it("injects runtime v3 with token, batching, watchdog messages, and nested relay", () => {
    expect(H5_POINTER_RUNTIME_VERSION).toBe("3");
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain('data-mathin-h5-runtime="3"');
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain("channelToken");
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain('event.source === parent');
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain("childFrameForSource(event.source)");
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain("allChildrenReady()");
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain('reportRootCapabilities(true)');
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain("relayDepth >= 8");
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain("requestAnimationFrame(flushMoves)");
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain('data-classroom-input-provider');
    expect(H5_OPAQUE_ORIGIN_RUNTIME).toContain('data.type === "pointer_takeover"');
    expect(H5_OPAQUE_ORIGIN_RUNTIME).not.toMatch(/\.click\s*\(/);
  });

  it("wires an independent fail-closed feature flag and classroom host", () => {
    const migration = readFileSync(
      new URL("../supabase/migrations/20260825000100_classroom_h5_pointer_v1_flag.sql", import.meta.url),
      "utf8",
    );
    const contract = readFileSync(
      new URL("../src/features/school/organization-settings-contract.ts", import.meta.url),
      "utf8",
    );
    const liveRoute = readFileSync(
      new URL("../src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx", import.meta.url),
      "utf8",
    );
    const liveShell = readFileSync(
      new URL("../src/features/classroom/live/LiveShell.tsx", import.meta.url),
      "utf8",
    );
    const docStage = readFileSync(
      new URL("../src/features/courseware-doc/DocStage.tsx", import.meta.url),
      "utf8",
    );
    expect(migration).toMatch(/teaching\.classroom_h5_pointer_v1', 1, false/);
    expect(contract).toContain('"teaching.classroom_h5_pointer_v1"');
    expect(liveRoute).toContain('isFeatureEnabled("teaching.classroom_h5_pointer_v1")');
    expect(liveShell).toContain("useH5PointerBridge");
    expect(docStage).toContain("pointerBridge.registerFrame(frameId, iframe)");
  });
});
