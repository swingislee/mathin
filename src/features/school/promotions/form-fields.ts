import type { FamilyFieldId } from "../../../../contracts/participant-api/onboarding";

/** Fixed record bindings. A form's display label never changes the destination. */
export const FORM_FIELD_BINDINGS: Record<FamilyFieldId, { zh: string; en: string; owner: "parent" | "child"; kind: "text" | "picker" | "interests" }> = {
  parentName: { zh: "联系人称呼", en: "Contact name", owner: "parent", kind: "text" },
  relation: { zh: "与参与人的关系", en: "Relationship to the participant", owner: "parent", kind: "picker" },
  childName: { zh: "参与人称呼", en: "Participant name", owner: "child", kind: "text" },
  grade: { zh: "参与人年级", en: "Participant grade", owner: "child", kind: "picker" },
  school: { zh: "就读学校", en: "School", owner: "child", kind: "text" },
  gender: { zh: "参与人性别", en: "Participant gender", owner: "child", kind: "picker" },
  interests: { zh: "感兴趣的内容", en: "Interests", owner: "child", kind: "interests" },
};
