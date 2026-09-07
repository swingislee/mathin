// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { CoursewareOverlayEditor } from "@/features/school/CoursewareOverlayEditor";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/school/actions/courseware", () => ({ saveCoursewareOverlay: vi.fn() }));
vi.mock("@/features/school/session-learning-actions", () => ({ replaceSessionLearningChecksAction: vi.fn() }));
vi.mock("@/features/school/teacher-preparation-actions", () => ({ saveCoursewareAnnotationAction: vi.fn(), generateSolutionRecordFromBoardAction: vi.fn() }));
vi.mock("@/features/school/courseware-overlay-upload", () => ({ overlayAssetKind: vi.fn(), uploadOverlayAsset: vi.fn() }));
vi.mock("@/features/classroom/courseware/upload", () => ({ downloadCoursewareAsset: vi.fn() }));
vi.mock("@/features/courseware-studio/StagePreview", () => ({ StagePreview: () => null }));
vi.mock("@/features/whiteboard/CanvasSurface", () => ({ CanvasSurface: () => null }));
vi.mock("@/features/whiteboard/Toolbar", () => ({ Toolbar: () => createElement("span", { "data-test-annotation-tools": true }, "Tools") }));
vi.mock("@/features/courseware-doc/CoursewareEditorWorkbench", () => ({ CoursewareWorkbench: (props: {
  previewActions: ReactNode; preview: ReactNode; toolbarTargetId?: string;
}) => createElement("div", null, props.previewActions, props.toolbarTargetId ? createElement("div", { id: props.toolbarTargetId }) : null, props.preview) }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount(canUnlockFrozen = true) {
  const pageId = "77777777-7777-4777-8777-777777777777";
  const editor = createElement(CoursewareOverlayEditor, {
    sessionId: "88888888-8888-4888-8888-888888888888", template: [],
    initialOverlay: [{ page: { id: pageId, docId: pageId, type: "doc", title: "Page" } }],
    annotations: [], solutionRecords: [], docPreviews: [{ pageDocId: pageId, doc: createEmptyCoursewareCompositionPage(), bindingUrls: {} }],
    learningCheckPages: [], initialLearningChecks: [], learningChecksLocked: true, learningChecksConfigured: true,
    readOnly: true, structureReadOnly: true, frozen: true, canUnlockFrozen,
    frozenEditActions: createElement("a", { href: "/edit", "data-test-edit-entry": true }, "Edit courseware"),
  });
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, children: editor })));
  await act(async () => vi.advanceTimersByTimeAsync(20));
}

async function toggleLock() {
  await act(async () => (host.querySelector('button[aria-pressed]') as HTMLButtonElement).click());
  await act(async () => vi.advanceTimersByTimeAsync(20));
}

describe("frozen courseware local unlock", () => {
  it("restores the edit entry and annotation toolbar after every unlock, including a recreated toolbar target", async () => {
    await mount();
    expect(host.querySelector("[data-test-edit-entry]")).toBeNull();
    expect(host.querySelector("[data-test-annotation-tools]")).toBeNull();
    for (let cycle = 0; cycle < 2; cycle++) {
      await toggleLock();
      expect(host.querySelector("[data-test-edit-entry]")).not.toBeNull();
      expect(host.querySelector("[data-test-annotation-tools]")).not.toBeNull();
      await toggleLock();
      expect(host.querySelector("[data-test-edit-entry]")).toBeNull();
      expect(host.querySelector("[data-test-annotation-tools]")).toBeNull();
    }
  });

  it("keeps the entry hidden and the lock disabled without archive-edit permission", async () => {
    await mount(false);
    expect((host.querySelector('button[aria-pressed]') as HTMLButtonElement).disabled).toBe(true);
    await toggleLock();
    expect(host.querySelector("[data-test-edit-entry]")).toBeNull();
    expect(host.querySelector("[data-test-annotation-tools]")).toBeNull();
  });
});
