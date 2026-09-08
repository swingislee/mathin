import { describe, expect, it, vi } from "vitest";
import {
  classroomDisplayHref,
  enterFromPreparation,
  initialClassroomView,
  parseClassroomEntry,
  preparationAction,
  type ClassroomRunMode,
  type ClassroomRunState,
} from "../src/features/classroom/preparation/preparation-contract";

const states: ClassroomRunState[] = ["scheduled", "started", "ended"];

describe("shared classroom preparation entry", () => {
  it("keeps waiting-room links reachable after start or end while retaining the continue shortcut", () => {
    for (const runState of states) {
      expect(initialClassroomView({ mode: "formal", runState, entry: "prep" })).toBe("prep");
      expect(initialClassroomView({ mode: "rehearsal", runState, entry: null })).toBe("prep");
    }
    expect(initialClassroomView({ mode: "formal", runState: "started", entry: null })).toBe("live");
    expect(initialClassroomView({ mode: "formal", runState: "scheduled", entry: "live" })).toBe("prep");
    expect(parseClassroomEntry(["prep"])).toBeNull();
    expect(parseClassroomEntry("prep")).toBe("prep");
  });

  it("starts a formal class before entering the stage, and leaves failures in preparation", async () => {
    const order: string[] = [];
    const enterStage = vi.fn(() => { order.push("stage"); });
    const options = {
      mode: "formal" as const, runState: "scheduled" as const, canEnter: true,
      startFormal: async () => { order.push("freeze-and-start"); }, enterStage,
    };
    await enterFromPreparation(options);
    expect(order).toEqual(["freeze-and-start", "stage"]);
    enterStage.mockClear();
    await expect(enterFromPreparation({ ...options, startFormal: async () => { throw new Error("OFFLINE"); } })).rejects.toThrow("OFFLINE");
    expect(enterStage).not.toHaveBeenCalled();
  });

  it.each(["rehearsal", "offline-drill"] as ClassroomRunMode[])("never starts formal teaching when entering %s, including ended classes", async (mode) => {
    const startFormal = vi.fn(async () => undefined);
    const enterStage = vi.fn();
    for (const runState of states) await enterFromPreparation({ mode, runState, canEnter: true, startFormal, enterStage });
    expect(startFormal).not.toHaveBeenCalled();
    expect(enterStage).toHaveBeenCalledTimes(3);
  });

  it("returns to an existing class without freezing or restarting it", async () => {
    const startFormal = vi.fn(async () => undefined);
    const enterStage = vi.fn();
    for (const runState of ["started", "ended"] as const) {
      for (let visit = 0; visit < 3; visit++) await enterFromPreparation({ mode: "formal", runState, canEnter: true, startFormal, enterStage });
    }
    expect(startFormal).not.toHaveBeenCalled();
    expect(enterStage).toHaveBeenCalledTimes(6);
    expect(preparationAction("formal", "started")).toBe("resume");
    expect(preparationAction("formal", "ended")).toBe("review");
  });

  it("keeps observers out of the teaching action", async () => {
    const startFormal = vi.fn(async () => undefined);
    const enterStage = vi.fn();
    await enterFromPreparation({ mode: "formal", runState: "scheduled", canEnter: false, startFormal, enterStage });
    expect(startFormal).not.toHaveBeenCalled();
    expect(enterStage).not.toHaveBeenCalled();
  });

  it("preserves rehearsal and offline isolation when opening a display", () => {
    for (const mode of ["rehearsal", "offline-drill"]) {
      const href = classroomDisplayHref("/en/classroom/class/session/session/live", `?mode=${mode}&entry=prep&acceptance=m4a`);
      const query = new URL(href, "https://example.test").searchParams;
      expect(query.get("mode")).toBe(mode);
      expect(query.get("role")).toBe("display");
      expect(query.get("acceptance")).toBe("m4a");
      expect(query.has("entry")).toBe(false);
    }
  });
});
