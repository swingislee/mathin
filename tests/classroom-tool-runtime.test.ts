import { describe, expect, it, vi } from "vitest";
import { createDefaultPlaceValueInitial, PLACE_VALUE_VERSION, placeValueSnapshot } from "@/features/tools/place-value/contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";

const key = (toolId: string, contentVersion: string) => `${toolId}\n${contentVersion}`;
const packet = (state: unknown) => ({ schema: "mathin-classroom-tool-state" as const, version: 1 as const, pageId: "page", docId: "doc", instanceId: "one",
  originHash: toolSceneOriginHash({ seed: 1 }), toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, state });
const validState = () => placeValueSnapshot(createDefaultPlaceValueInitial());

describe("classroom tool runtime", () => {
  it("lists exactly the strict classroom contracts and tool scene versions", async () => {
    const [{ classroomToolEventSchema }, runtime, { toolSceneSchema, isToolScene }, { isCubeCoursewareTool }] = await Promise.all([
      import("@/features/tools/courseware/tool-classroom"), import("@/features/tools/courseware/tool-classroom-runtime"),
      import("@/features/tools/scenes/contract"), import("@/features/tools/courseware/cube-structures-content"),
    ]);
    const strict = classroomToolEventSchema.options.map((schema) => key(schema.shape.toolId.value, schema.shape.contentVersion.value));
    const scenes = toolSceneSchema.options.map((schema) => key(schema.shape.toolId.value, schema.shape.contentVersion.value));
    expect([...runtime.classroomToolAdapterKeys()].sort()).toEqual([...strict].sort());
    expect([...runtime.classroomToolAdapterKeys()].sort()).toEqual([...scenes].sort());
    for (const version of [...scenes.map((value) => value.split("\n")[1]), "tool-embed-v1", "cube-structures-lesson-v1", "unknown"]) {
      expect(runtime.isToolSceneVersion({ contentVersion: version })).toBe(isToolScene({ contentVersion: version }));
      expect(isCubeCoursewareTool({ contentVersion: version })).toBe(["cube-structures-lesson-v1", "cube-structures-lesson-v2", "cube-structures-lesson-v3"].includes(version));
    }
  });

  it("keeps envelopes until the tool family loads, then validates strictly", async () => {
    vi.resetModules();
    const runtime = await import("@/features/tools/courseware/tool-classroom-runtime");
    const tool = { toolId: "place-value", contentVersion: PLACE_VALUE_VERSION };
    expect(runtime.isClassroomToolContractLoaded(tool)).toBe(false);
    const invalid = packet({ broken: true });
    expect(runtime.acceptClassroomToolState(invalid)).toEqual(invalid);
    expect(runtime.verifyClassroomToolState(invalid)).toBeUndefined();
    expect(runtime.acceptClassroomToolState({ ...invalid, toolId: "unknown-tool" })).toBeNull();
    expect(runtime.acceptClassroomToolState({ ...invalid, instanceId: "__proto__" })).toBeNull();
    expect(runtime.acceptClassroomToolState({ ...invalid, extra: true })).toBeNull();

    expect(await runtime.loadClassroomToolContract(tool)).toBe(true);
    expect(runtime.isClassroomToolContractLoaded({ toolId: "soma-cube", contentVersion: "soma-cube-lesson-v2" })).toBe(false);
    expect(runtime.verifyClassroomToolState(invalid)).toBeNull();
    expect(runtime.acceptClassroomToolState(invalid)).toBeNull();
    const valid = packet(validState());
    expect(runtime.acceptClassroomToolState(valid)).toMatchObject({ toolId: "place-value", instanceId: "one" });
    await expect(runtime.createVerifiedClassroomToolState("page", "doc", "one", { toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, state: validState() } as never, valid.originHash))
      .resolves.toMatchObject({ pageId: "page", docId: "doc", instanceId: "one" });
    await expect(runtime.createVerifiedClassroomToolState("page", "doc", "one", { toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, state: { broken: true } } as never, valid.originHash))
      .rejects.toThrow("CLASSROOM_TOOL_STATE_INVALID_OR_TOO_LARGE");
  });
});
