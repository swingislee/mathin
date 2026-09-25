// @vitest-environment jsdom
import { act, createElement as h, useImperativeHandle, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { MicrocourseEditor } from "@/features/teacher-microcourses/MicrocourseEditor";
import type { TeacherMicrocourseEditor } from "@/features/teacher-microcourses/data";
import type { QuestionGroupState } from "@/features/interactive-questions/contract";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";

const deps = vi.hoisted(() => ({ save: vi.fn(), flush: vi.fn(), refresh: vi.fn(), metadata: vi.fn(), select: vi.fn(), submit: vi.fn() }));
vi.mock("@/features/teacher-microcourses/question-group-actions", () => ({ saveMicrocourseQuestionGroups: deps.save }));
vi.mock("@/features/teacher-microcourses/actions", () => ({ createTeacherCompositionPageAction: vi.fn(), deleteTeacherMicrocoursePageAction: vi.fn(), reorderTeacherMicrocoursePagesAction: vi.fn(), saveTeacherMicrocourseMetadataAction: deps.metadata, selectTeacherMicrocourseVariantAction: deps.select, submitTeacherMicrocourseReviewAction: deps.submit, withdrawTeacherMicrocourseAction: vi.fn(), withdrawTeacherMicrocourseReviewAction: vi.fn() }));
vi.mock("@/features/teacher-microcourses/MicrocourseSourcePicker", () => ({ MicrocourseSourcePicker: () => null }));
vi.mock("@/features/interactive-questions/InteractiveQuestionEditor", () => ({ InteractiveQuestionEditor: ({ ref }: { ref: Ref<unknown> }) => { useImperativeHandle(ref, () => ({ flush: deps.flush })); return h("div", null, "Shared question canvas"); } }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: deps.refresh, push: vi.fn() }), Link: (props: { children: ReactNode }) => h("span", null, props.children) }));
vi.mock("@/features/courseware-doc/CoursewareEditorWorkbench", () => ({
  CoursewareWorkbench: ({ directory, canvas }: { directory: { header: ReactNode; content: ReactNode; footer: ReactNode }; canvas: { content: ReactNode } }) => h("div", null, directory.header, directory.content, directory.footer, canvas.content),
  CoursewareWorkbenchPageRail: ({ items }: { items: { id: string; title: string }[] }) => h("ol", null, items.map(item => h("li", { key: item.id }, item.title))),
  CoursewareWorkbenchDirectoryHeader: () => null, CoursewareWorkbenchAddPageButton: () => null, CoursewareWorkbenchPageActions: () => null, CoursewareWorkbenchDeletePageDialog: () => null, CoursewareWorkbenchPager: () => null,
}));
const id = "12345678-1234-4234-9234-123456789abc";
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); deps.flush.mockResolvedValue(true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(withSession = false) {
  const editor = { id, topics: [], questionGroups: { version: 0, groups: [] }, draftMetadata: { title: "交互练习", description: "", grade: 3, courseSeason: null, classType: "", primaryTopicSlug: "logic-strategy", keywords: [] },
    pages: [{ pageDocId: id, pageNo: 1, title: "第一题", revisionId: id, revisionNo: 1, doc: createEmptyCoursewareCompositionPage(), bindings: [], bindingUrls: {} }] } as unknown as TeacherMicrocourseEditor;
  await act(async () => root.render(h(NextIntlClientProvider, { locale: "zh", messages: zh, timeZone: "Asia/Shanghai", children: h(MicrocourseEditor, { editor, canTeach: true, session: withSession ? { id, title: "测试课次", classroomId: id, coursewareFrozenAt: null } : undefined }) })));
}
async function fillName(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="分组名称"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  return input;
}
const add = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "新建分组")!;
it("flushes the current question before creating a persistent empty group", async () => {
  deps.save.mockImplementation(async ({ groups }: QuestionGroupState) => ({ ok: true, data: { version: 1, groups } }));
  await mount(); await fillName("基础过关"); await act(async () => add().click());
  expect(deps.flush).toHaveBeenCalledOnce();
  expect(deps.save).toHaveBeenCalledWith({ microcourseId: id, version: 0, groups: [expect.objectContaining({ name: "基础过关", questionIds: [] })] });
  expect(host.querySelector("[data-question-group]")?.textContent).toContain("基础过关");
});
it("retains a group name when saving fails and does not switch away from the question", async () => {
  deps.save.mockResolvedValue({ ok: false, code: "CONFLICT" }); await mount(); const input = await fillName("能力提升"); await act(async () => add().click());
  expect(input.value).toBe("能力提升"); expect(host.textContent).toContain("分组已被其他人更新"); expect(host.textContent).toContain("第一题");
});
it("keeps the current question when its canvas cannot be saved", async () => {
  deps.flush.mockResolvedValue(false); await mount(); const input = await fillName("基础过关"); await act(async () => add().click());
  expect(deps.save).not.toHaveBeenCalled(); expect(input.value).toBe("基础过关"); expect(host.textContent).toContain("第一题");
});
it("saves and submits the complete microcourse while an empty group is selected", async () => {
  deps.save.mockImplementation(async ({ groups }: QuestionGroupState) => ({ ok: true, data: { version: 1, groups } }));
  deps.metadata.mockResolvedValue({ ok: true }); deps.select.mockResolvedValue({ ok: true }); deps.submit.mockResolvedValue({ ok: true });
  await mount(true); await fillName("能力提升"); await act(async () => add().click());
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
  await act(async () => button(zh.teacherMicrocourses.saveForSessionAndReturn).click());
  expect(deps.select).toHaveBeenCalledWith({ sessionId: id, microcourseId: id });
  await act(async () => button(zh.teacherMicrocourses.editDetails).click());
  expect(button(zh.teacherMicrocourses.submitReview).disabled).toBe(false);
  await act(async () => button(zh.teacherMicrocourses.submitReview).click());
  expect(deps.submit).toHaveBeenCalledWith({ microcourseId: id, note: "" });
});
