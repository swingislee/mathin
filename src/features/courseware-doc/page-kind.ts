import type { AixuexiPageDoc } from "./aixuexi-schema";
import type { CoursewareCompositionPage } from "./composition-page-schema";
import type { GamePageDoc } from "./game-page-schema";
import type { MicrocoursePageDoc } from "./microcourse-schema";
import type { SourceRuntimePageDoc } from "./source-runtime-schema";

// 页类型版本与按 docVersion 的判断。客户端按页类型分派舞台时只需这些字符串比较；
// 各 schema 模块从这里取用并再导出，校验所需的 zod 图、教具合同与 three 留在按需加载的舞台里。
export const AIXUEXI_PAGE_DOC_VERSION = "aixuexi-page-doc-v1";
export const COURSEWARE_COMPOSITION_DOC_VERSION = "courseware-composition-v1" as const;
export const GAME_PAGE_DOC_VERSION = "game-page-v1" as const;
export const MICROCOURSE_PAGE_DOC_VERSION = "microcourse-page-v1" as const;
export const SOURCE_RUNTIME_PAGE_DOC_VERSION = "source-runtime-page-v1";

export function isAixuexiPageDoc(doc: { docVersion?: string }): doc is AixuexiPageDoc {
  return doc.docVersion === AIXUEXI_PAGE_DOC_VERSION;
}

export function isCoursewareCompositionPage(
  doc: { readonly docVersion: string },
): doc is CoursewareCompositionPage {
  return doc.docVersion === COURSEWARE_COMPOSITION_DOC_VERSION;
}

export function isGamePageDoc(
  doc: { readonly docVersion: string },
): doc is GamePageDoc {
  return doc.docVersion === GAME_PAGE_DOC_VERSION;
}

export function isMicrocoursePageDoc(
  doc: { readonly docVersion: string },
): doc is MicrocoursePageDoc {
  return doc.docVersion === MICROCOURSE_PAGE_DOC_VERSION;
}

export function isSourceRuntimePageDoc(
  doc: { readonly docVersion: string },
): doc is SourceRuntimePageDoc {
  return doc.docVersion === SOURCE_RUNTIME_PAGE_DOC_VERSION;
}
