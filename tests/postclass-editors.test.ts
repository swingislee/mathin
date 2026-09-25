// @vitest-environment jsdom
import { act, createElement as h, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { HomeworkDocumentEditor } from "@/features/school/HomeworkDocumentEditor";
import { PostclassLearningEditor } from "@/features/school/PostclassLearningEditor";
import { bindHomeworkQuestion, createHomeworkQuestions, homeworkContentFor, type HomeworkWorkspace } from "@/features/school/homework-document-contract";
import { postclassLearningChanges, type PostclassLearning } from "@/features/school/postclass-learning-contract";

const deps = vi.hoisted(() => ({ readHomework: vi.fn(), saveHomework: vi.fn(), readLearning: vi.fn(), saveLearning: vi.fn() }));
vi.mock("@/features/school/homework-document-actions", () => ({ readHomeworkDocument: deps.readHomework, saveHomeworkDocument: deps.saveHomework }));
vi.mock("@/features/school/postclass-learning-actions", () => ({ readPostclassLearning: deps.readLearning, savePostclassLearning: deps.saveLearning }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const id = "12345678-1234-4234-9234-123456789abc", studentId = "12345678-1234-4234-9234-123456789def";
const doc = (): HomeworkWorkspace => ({ version: 1, revision: "saved-version", canWrite: true, classTemplate: null, lectureTemplate: null, students: [{ id: studentId, name: "示例学生" }],
  document: { topic: "旧主题", instructions: "", lessonPlan: "", dueAt: null, questions: [{ id, label: "1", group: "基础", content: "共同题目", answer: "参考", sourceQuestionId: null }], overrides: [] } });
const learning = (): PostclassLearning => ({ revision: "read-version", checks: [{ id, title: "原检查点", position: 0 }], students: [{ id: studentId, name: "示例学生" }],
  results: [{ checkId: id, studentId, status: "prompted" }], reviews: [{ studentId, studentName: "示例学生", entryScore: null, exitScore: null, focus: 3, participation: null, mastery: null, comment: "原评语" }] });
let root: Root, container: HTMLDivElement;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(row => row.textContent === text)!;
const click = async (element: HTMLElement) => { expect(element).toBeTruthy(); await act(async () => element.click()); };
async function fill(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, text); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function render(child: ComponentProps<typeof NextIntlClientProvider>["children"]) {
  await act(async () => root.render(h(NextIntlClientProvider, { locale: "zh", messages: zh, timeZone: "Asia/Shanghai", children: child })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => { for (let n = 0; n < array.length; n++) array[n] = Math.floor(Math.random() * 256); return array; } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  deps.readHomework.mockResolvedValue({ ok: true, data: doc() }); deps.readLearning.mockResolvedValue({ ok: true, data: learning() });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("课后修订", () => {
  it("更名和补录保留原检查点 ID，只提交改变的学生记录", () => {
    const before = learning(); const after = structuredClone(before); after.checks[0].title = "更正标题"; after.reviews[0].comment = "更正评语";
    expect(postclassLearningChanges(before, after)).toEqual({ changes: [], reviews: [after.reviews[0]] });
    expect(after.checks[0].id).toBe(before.checks[0].id);
  });
  it("正式课后记录可以修订；冲突保留草稿和原版本", async () => {
    deps.saveLearning.mockResolvedValueOnce({ ok: false, code: "CONFLICT" });
    const onSaved = vi.fn(); await render(h(PostclassLearningEditor, { sessionId: id, onSaved })); await click(button("补录／修订学情"));
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    await fill(textarea, "复盘更正"); await click(button("保存修订"));
    expect(deps.saveLearning).toHaveBeenCalledWith(expect.objectContaining({ revision: "read-version", changes: [], reviews: [expect.objectContaining({ studentId, comment: "复盘更正" })] }));
    expect(textarea.value).toBe("复盘更正"); expect(document.body.textContent).toContain("记录已被其他操作更新"); expect(onSaved).not.toHaveBeenCalled();
  });
});
describe("作业题库与模板", () => {
  it("6题/8题模板在无 randomUUID 的局域网环境生成独立题号", () => {
    const six = createHomeworkQuestions(6), eight = createHomeworkQuestions(8, "提高");
    expect(six.map(q => q.label)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(new Set([...six, ...eight].map(q => q.id)).size).toBe(14); expect(eight.every(q => q.group === "提高")).toBe(true);
  });
  it("绑定复制内容并保留班级题号，逐生自定义不改变共同题目", () => {
    const document = doc().document, original = document.questions[0];
    const source = { ...original, id: studentId, group: "教研", label: "讲次题", content: "讲次内容" };
    const bound = bindHomeworkQuestion(original, source);
    expect(bound).toMatchObject({ id, group: "基础", label: "1", content: "讲次内容", sourceQuestionId: studentId });
    source.content = "后续新题"; expect(bound.content).toBe("讲次内容");
    document.overrides = [{ studentId, questionId: id, content: "学生专用题" }];
    expect(homeworkContentFor(document, id, studentId)).toBe("学生专用题"); expect(homeworkContentFor(document, id)).toBe("共同题目");
  });
  it("编辑已发布作业主题成功后更新回显；保存失败保留输入", async () => {
    deps.saveHomework.mockResolvedValueOnce({ ok: false, code: "CONFLICT" }).mockResolvedValueOnce({ ok: true, data: { ...doc(), document: { ...doc().document, topic: "新主题" } } });
    const onSaved = vi.fn(); await render(h(HomeworkDocumentEditor, { scope: "assignment", targetId: id, onSaved })); await click(button("编辑作业与课后主题"));
    const input = document.querySelector<HTMLInputElement>('input[value="旧主题"]')!;
    await fill(input, "新主题"); await click(button("保存")); expect(input.value).toBe("新主题"); expect(onSaved).not.toHaveBeenCalled();
    await click(button("保存")); expect(onSaved).toHaveBeenCalledOnce();
    expect(deps.saveHomework).toHaveBeenLastCalledWith(expect.objectContaining({ revision: "saved-version", document: expect.objectContaining({ topic: "新主题" }) }));
  });
  it("题干和答案分列连续录入，新增分组可独立保存", async () => {
    deps.saveHomework.mockResolvedValue({ ok: false, code: "CONFLICT" });
    await render(h(HomeworkDocumentEditor, { scope: "lecture", targetId: id })); await click(button("本讲作业与标准教案"));
    const headers = [...document.querySelectorAll("th")].map(row => row.textContent);
    expect(headers.slice(0, 3)).toEqual(["题号", "题目／题干", "答案／解析"]);
    await fill(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="题目／题干"]')!, "连续录入题目");
    await fill(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="答案／解析"]')!, "连续录入答案");
    await fill(document.querySelector<HTMLInputElement>('input[aria-label="分组名称"]')!, "能力提升");
    await click(button("新建分组")); await click(button("新增题目")); await click(button("保存"));
    const documentValue = deps.saveHomework.mock.calls[0][0].document;
    expect(documentValue.groups).toEqual(["基础", "能力提升"]);
    expect(documentValue.questions).toHaveLength(2);
    expect(documentValue.questions[0]).toMatchObject({ content: "连续录入题目", answer: "连续录入答案" });
    expect(documentValue.questions[1]).toMatchObject({ group: "能力提升", label: "1" });
    expect(document.body.textContent).toContain("草稿已保留");
  });
});
