// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { CoursewareCompositionWorkbench, type CompositionPagePersistence } from "@/features/teacher-microcourses/CoursewareCompositionWorkbench";
import type { CoursewareCompositionGridEditor } from "@/features/courseware-doc/CoursewareCompositionGridEditor";
import { createFormalCubePage } from "@/features/courseware-studio/formal-cube-page-contract";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { CreateBlankCoursewarePageButton } from "@/features/courseware-studio/FormalCubePageEditor";
import { CoursewareWorkbenchAddPageButton, CoursewareWorkbenchDirectoryHeader } from "@/features/courseware-doc/CoursewareEditorWorkbench";

type GridProps = ComponentProps<typeof CoursewareCompositionGridEditor>;
const grid = vi.hoisted(() => ({ props: null as GridProps | null }));
const microcourseSave = vi.hoisted(() => vi.fn());
const blankPageCreate = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: { children?: ReactNode; href: string }) => createElement("a", props), useRouter: () => router }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/features/courseware-studio/formal-manual-page-actions", () => ({ createBlankCoursewarePageAction: blankPageCreate, saveFormalManualPageAction: vi.fn() }));
vi.mock("@/features/courseware-studio/formal-cube-page-actions", () => ({ saveFormalCubePageAction: vi.fn() }));
vi.mock("@/features/courseware-studio/actions", () => ({ createCoursewarePageH5Action: vi.fn(), uploadCoursewarePageImageAction: vi.fn() }));
vi.mock("@/features/teacher-microcourses/actions", () => ({
  saveTeacherMicrocoursePageAction: microcourseSave, uploadTeacherMicrocourseImageAction: vi.fn(),
  createTeacherGameComponentAction: vi.fn(), createTeacherH5ComponentArtifactAction: vi.fn(), loadTeacherMicrocourseH5HtmlAction: vi.fn(),
}));
vi.mock("@/features/courseware-doc/CoursewareCompositionGridEditor", () => ({ CoursewareCompositionGridEditor: (props: GridProps) => {
  grid.props = props; return createElement("div", { "data-test-grid": true });
} }));
vi.mock("@/features/courseware-doc/CoursewareEditorAdapterSurface", () => ({ CoursewareEditorAdapterSurface: (props: { children: ReactNode; toolbar: ReactNode; inspector: ReactNode; saveControls: ReactNode }) =>
  createElement("div", null, props.toolbar, props.saveControls, props.inspector, props.children),
}));
vi.mock("@/features/games/courseware/GamePageEditor", () => ({ GamePageEditor: () => null }));
vi.mock("@/features/teacher-microcourses/CubeDraftCoursewarePicker", () => ({ CubeDraftCoursewarePicker: ({ onReady }: { onReady: (tool: ReturnType<typeof createCubeCoursewareTool>) => void }) =>
  createElement("button", { type: "button", "data-select-cube": true, onClick: () => onReady(createCubeCoursewareTool({ name: "Selected cube", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current", ["cut"])) }, "Select draft"),
  CubeFrozenCoursewarePreview: () => null }));
vi.mock("@/features/teacher-microcourses/CubeCoursewareToolbarSettings", () => ({ CubeCoursewareToolbarSettings: () => null }));
vi.mock("@/features/courseware-doc/CoursewareH5AuthoringDialog", () => ({ CoursewareH5AuthoringDialog: () => null }));

const pageDoc = () => createFormalCubePage(createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current", ["cut"]));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  microcourseSave.mockReset(); blankPageCreate.mockReset(); router.push.mockReset(); router.refresh.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount(persistence?: CompositionPagePersistence, doc = pageDoc()) {
  const props = { page: { pageDocId: "77777777-7777-4777-8777-777777777777", title: "Cube", revisionNo: 1, doc, bindingUrls: {} }, onPersisted: vi.fn(), onStatus: vi.fn() };
  const editor = persistence
    ? createElement(CoursewareCompositionWorkbench, { ...props, persistence })
    : createElement(CoursewareCompositionWorkbench, { ...props, microcourseId: "88888888-8888-4888-8888-888888888888" });
  // next-intl 将 children 声明为必填；显式传入以符合 React 19 的类型。
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, children: editor })));
}

async function changeBackground(value: string) {
  await act(async () => grid.props!.onChange({ ...grid.props!.doc, canvas: { ...grid.props!.doc.canvas, backgroundColor: value } }));
}

describe("formal cube editor persistence adapter", () => {
  it("creates a blank page immediately without a cube picker and opens its stable page ID", async () => {
    const lectureId = "88888888-8888-4888-8888-888888888888";
    const pageId = "77777777-7777-4777-8777-777777777777";
    blankPageCreate.mockResolvedValue({ ok: true, data: { pageDocId: pageId } });
    const button = createElement(CoursewareWorkbenchDirectoryHeader, { title: "Pages",
      action: createElement(CreateBlankCoursewarePageButton, { lectureId, returnTo: "/dashboard/courses" }) });
    // eslint-disable-next-line react/no-children-prop
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, children: button })));
    const addPageButton = host.querySelector('[data-courseware-editor-action="add-page"]') as HTMLButtonElement;
    expect(addPageButton.getAttribute("aria-label")).toBe(en.coursewareWorkspace.createBlankPage);
    expect(addPageButton.title).toBe(en.coursewareWorkspace.createBlankPage);
    expect(addPageButton.textContent).toBe("");
    expect(addPageButton.querySelector("svg")).not.toBeNull();
    expect(addPageButton.classList.contains("size-8")).toBe(true);
    expect(host.querySelector("h2")!.compareDocumentPosition(addPageButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("[data-select-cube]")).toBeNull();
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    expect(blankPageCreate).toHaveBeenCalledWith({ lectureId, afterPageDocId: null, title: en.coursewareWorkspace.blankPageTitle });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push.mock.calls[0][0]).toContain(`compositionPage=${pageId}`);
    expect(router.push.mock.calls[0][0]).toContain("returnTo=%2Fdashboard%2Fcourses");
  });

  it("uses the same icon button and disabled behavior for the microcourse action", async () => {
    const onClick = vi.fn();
    const render = (disabled: boolean) => createElement(CoursewareWorkbenchDirectoryHeader, { title: "Pages",
      action: createElement(CoursewareWorkbenchAddPageButton, { label: en.teacherMicrocourses.addBlank, disabled, onClick }) });
    await act(async () => root.render(render(true)));
    const button = host.querySelector('[data-courseware-editor-action="add-page"]') as HTMLButtonElement;
    expect(button.textContent).toBe("");
    expect(button.title).toBe(en.teacherMicrocourses.addBlank);
    expect(button.classList.contains("size-8")).toBe(true);
    await act(async () => button.click());
    expect(onClick).not.toHaveBeenCalled();
    await act(async () => root.render(render(false)));
    await act(async () => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("starts blank and inserts the selected cube only through the existing tool-component dialog", async () => {
    const save = vi.fn<CompositionPagePersistence["save"]>().mockImplementation(async (input) => ({ ok: true, data: { doc: input.doc, revisionNo: 2 } }));
    await mount({ save, uploadImage: vi.fn() }, createEmptyCoursewareCompositionPage());
    expect(grid.props!.doc.layout.blocks).toEqual([]);
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    await act(async () => (host.querySelector(`button[aria-label="${en.teacherMicrocourses.componentTool}"]`) as HTMLButtonElement).click());
    expect(grid.props!.doc.layout.blocks).toEqual([]);
    await act(async () => (document.querySelector("[data-select-cube]") as HTMLButtonElement).click());
    const insert = [...document.querySelectorAll("button")].find((button) => button.textContent === en.teacherMicrocourses.insertComponent)!;
    await act(async () => insert.click());
    expect(grid.props!.doc.layout.blocks).toHaveLength(1);
    expect(grid.props!.doc.layout.blocks[0]).toMatchObject({ type: "tool", tool: { contentVersion: "cube-structures-lesson-v2", payload: { title: "Selected cube", toolbar: ["cut"] } } });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(save).toHaveBeenCalledTimes(1);
    expect(microcourseSave).not.toHaveBeenCalled();
  });

  it("reuses the composition editor and leaves microcourse-owned asset actions disabled", async () => {
    await mount({ save: vi.fn() });
    const disabled = [...host.querySelectorAll("button:disabled")].map((button) => button.getAttribute("aria-label"));
    expect(disabled).toContain(en.coursewareWorkspace.prototypeInsertImage);
    expect(disabled).toContain(en.coursewareWorkspace.prototypeInsertGame);
    expect(disabled).toContain(en.coursewareWorkspace.prototypeInsertH5);
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(grid.props!.doc.docVersion).toBe("courseware-composition-v1");
    expect(microcourseSave).not.toHaveBeenCalled();
  });

  it("preserves newer edits during an in-flight save and uses the returned revision for the next save", async () => {
    let finish!: (value: Awaited<ReturnType<CompositionPagePersistence["save"]>>) => void;
    const save = vi.fn<CompositionPagePersistence["save"]>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockImplementation(async (input) => ({ ok: true, data: { doc: input.doc, revisionNo: 3 } }));
    await mount({ save });
    await changeBackground("#ffffff");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(save).toHaveBeenCalledTimes(1);
    await changeBackground("#eeeeee");
    await act(async () => finish({ ok: true, data: { doc: save.mock.calls[0][0].doc, revisionNo: 2 } }));
    expect(grid.props!.doc.canvas.backgroundColor).toBe("#eeeeee");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(save.mock.calls[1][0]).toMatchObject({ baseRevisionNo: 2, doc: { canvas: { backgroundColor: "#eeeeee" } } });
    expect(microcourseSave).not.toHaveBeenCalled();
  });

  it("retains the local document and expected revision when the server rejects a conflict", async () => {
    const save = vi.fn<CompositionPagePersistence["save"]>().mockResolvedValue({ ok: false, code: "VERSION_CONFLICT" });
    await mount({ save });
    await changeBackground("#dddddd");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(grid.props!.doc.canvas.backgroundColor).toBe("#dddddd");
    expect(host.textContent).toContain("VERSION_CONFLICT");
    await changeBackground("#cccccc");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(save.mock.calls[1][0].baseRevisionNo).toBe(1);
  });

  it("keeps the existing microcourse save route and image control for microcourse authors", async () => {
    microcourseSave.mockImplementation(async (input) => ({ ok: true, data: { doc: input.doc, revisionNo: 2 } }));
    await mount();
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    await changeBackground("#dddddd");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(microcourseSave).toHaveBeenCalledTimes(1);
  });
});
