import { describe, expect, it } from "vitest";
import { DEFAULT_FAMILY_FORM, familyAnswerErrors, type FamilyAnswers } from "../contracts/participant-api/onboarding";
import { familyFormConfigSchema } from "@/features/parent-portal/family-form";
import { familyRegistrationSchema } from "@/features/parent-portal/onboarding-contract";

const answers: FamilyAnswers = { parentName: "", relation: "mother", childName: "小名", grade: 3, gender: "", school: "", interests: ["math"] };
describe("promotion-specific family forms", () => {
  it("allows a preferred child name and optional parent name without claiming a verified name", () => {
    expect(familyAnswerErrors(DEFAULT_FAMILY_FORM, answers)).toEqual([]);
  });
  it("uses each promotion's interest options and requirement rules", () => {
    const form = structuredClone(DEFAULT_FAMILY_FORM);
    form.fields.find(field => field.id === "interests")!.options = [{ id: "reading", label: { zh: "阅读", en: "Reading" } }];
    expect(familyAnswerErrors(form, answers)).toEqual(["interests"]);
    expect(familyAnswerErrors(form, { ...answers, interests: ["reading"] })).toEqual([]);
    form.fields.find(field => field.id === "interests")!.mode = "optional";
    expect(familyAnswerErrors(form, { ...answers, interests: [] })).toEqual([]);
  });
  it("does not accept hidden answers or silently relax required fields", () => {
    const form = structuredClone(DEFAULT_FAMILY_FORM);
    form.fields.find(field => field.id === "school")!.mode = "hidden";
    expect(familyAnswerErrors(form, { ...answers, school: "Unrequested", childName: "" })).toEqual(["childName", "school"]);
    form.fields.find(field => field.id === "childName")!.mode = "optional";
    expect(familyAnswerErrors(form, { ...answers, childName: "" })).toEqual([]);
  });
  it("checks each child separately while sharing the parent's answers", () => {
    const family = { ...answers, children: [{ key: "child-1", ...answers }, { key: "child-2", ...answers, childName: "另一个昵称", grade: null }] };
    expect(familyAnswerErrors(DEFAULT_FAMILY_FORM, family)).toEqual(["grade"]);
    family.children[1].grade = 5;
    expect(familyAnswerErrors(DEFAULT_FAMILY_FORM, family)).toEqual([]);
  });
  it("rejects duplicate fields, duplicate options and injected field names", () => {
    const form = structuredClone(DEFAULT_FAMILY_FORM);
    expect(familyFormConfigSchema.safeParse(form).success).toBe(true);
    expect(familyFormConfigSchema.safeParse({ ...form, fields: [...form.fields.slice(0, 6), form.fields[0]] }).success).toBe(false);
    form.fields[0].id = "phone" as never;
    expect(familyFormConfigSchema.safeParse(form).success).toBe(false);
    const duplicate = structuredClone(DEFAULT_FAMILY_FORM);
    duplicate.fields[6].options!.push(duplicate.fields[6].options![0]);
    expect(familyFormConfigSchema.safeParse(duplicate).success).toBe(false);
  });
  it("bounds household size and refuses duplicate child keys", () => {
    const child = { key: "child-1", childName: "Nickname", grade: 3, gender: "", school: "", interests: ["math"] };
    const payload = { ...answers, children: [child, child], location: { status: "unavailable" }, consent: true, privacyVersion: "v1", childrenPrivacyVersion: "v1" };
    expect(familyRegistrationSchema.safeParse(payload).success).toBe(false);
    expect(familyRegistrationSchema.safeParse({ ...payload, children: [child] }).success).toBe(true);
  });
});
