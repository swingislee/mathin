import type { FamilyFieldId } from "../../../../contracts/participant-api/onboarding";

/** Fixed record bindings. A form's display label never changes the destination. */
export const FORM_FIELD_BINDINGS: Record<FamilyFieldId, { zh: string; en: string; owner: "parent" | "child"; kind: "text" | "picker" | "interests" }> = {
  parentName: { zh: "家长称呼", en: "Parent name", owner: "parent", kind: "text" },
  relation: { zh: "与孩子的关系", en: "Relationship", owner: "parent", kind: "picker" },
  childName: { zh: "孩子称呼", en: "Child name", owner: "child", kind: "text" },
  grade: { zh: "孩子年级", en: "Child grade", owner: "child", kind: "picker" },
  school: { zh: "就读学校", en: "School", owner: "child", kind: "text" },
  gender: { zh: "孩子性别", en: "Child gender", owner: "child", kind: "picker" },
  interests: { zh: "感兴趣的内容", en: "Interests", owner: "child", kind: "interests" },
};
