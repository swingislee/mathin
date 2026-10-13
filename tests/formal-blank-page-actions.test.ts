import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankCoursewarePageAction, createFormalGameComponentAction, saveFormalManualPageAction } from "@/features/courseware-studio/formal-manual-page-actions";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";

const rpc = vi.hoisted(() => vi.fn());
const authorized = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: authorized }));
vi.mock("@/features/courseware-studio/data", () => ({ COURSEWARE_TRACKS: ["native-16x9", "adapted-4x3"] }));
beforeEach(() => {
  rpc.mockReset(); authorized.mockReset(); authorized.mockResolvedValue({ supabase: { rpc } });
});
const input = { lectureId: "77777777-7777-4777-8777-777777777777", afterPageDocId: null, title: "Untitled" };

describe("restored blank page creation action", () => {
  it("recomputes a forged game validation receipt before saving the page", async () => {
    const created=await createFormalGameComponentAction({gameId:"sudoku",contentVersion:"sudoku-authored-v3"});
    if(!created.ok) throw Error("component creation failed");
    const game=created.data.game;
    game.payload={...(game.payload as Record<string,unknown>),goal:{kind:"full-solution",requireUnique:true}};
    game.validation={...game.validation,publishable:true,code:"unique-solution"};
    const doc=createEmptyCoursewareCompositionPage();
    doc.layout.blocks.push({id:"game",type:"game",placement:{column:0,row:0,columnSpan:8,rowSpan:8},game});
    rpc.mockResolvedValue({data:[{revision_no:2}],error:null});
    expect(await saveFormalManualPageAction({pageDocId:input.lectureId,track:"native-16x9",doc,baseRevisionNo:1,note:""})).toMatchObject({ok:true});
    const saved=rpc.mock.calls.at(-1)![1].p_doc.layout.blocks[0].game;
    expect(saved.validation.publishable).toBe(false);
    expect(saved.validation.code).not.toBe("unique-solution");
  });
  it("calls the original generic RPC with page context only, without a component payload", async () => {
    rpc.mockResolvedValue({ data: "88888888-8888-4888-8888-888888888888", error: null });
    expect(await createBlankCoursewarePageAction(input)).toMatchObject({ ok: true });
    expect(authorized).toHaveBeenCalledWith("courseware.page.edit");
    expect(rpc).toHaveBeenCalledWith("create_blank_cw_page", { p_lecture_id: input.lectureId, p_after_page_doc_id: undefined, p_title: "Untitled" });
  });
  it("rejects prefilled component input and reports create failures without claiming success", async () => {
    expect(await createBlankCoursewarePageAction({ ...input, tool: {} } as typeof input)).toEqual({ ok: false, code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "RELATION_REQUIRED" } });
    expect(await createBlankCoursewarePageAction(input)).toEqual({ ok: false, code: "RELATION_REQUIRED" });
  });
});
