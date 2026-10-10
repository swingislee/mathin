import type { LocalizedText, RegistrationRecord } from "../../../contracts/participant-api/portal";
import { DEFAULT_FAMILY_FORM, FAMILY_FIELD_IDS } from "../../../contracts/participant-api/onboarding";
import { onboardingChoices } from "../../../contracts/participant-api/onboarding-presentation";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const string = (value: unknown) => typeof value === "string" ? value.slice(0, 2000) : "";
const both = (value: string): LocalizedText => ({ zh: value, en: value });
const localized = (value: unknown, fallback: LocalizedText): LocalizedText => {
  const copy = object(value);
  return { zh: string(copy.zh) || fallback.zh, en: string(copy.en) || string(copy.zh) || fallback.en };
};
const empty = { zh: "未填写", en: "Not provided" };
const choices = { zh: onboardingChoices("zh"), en: onboardingChoices("en") };

/** Only submitted, user-facing fields leave the ledger; proof, location and staff data stay private. */
export function projectRegistration(row: {
  id: string; intake_kind: string; created_at: string; completed_at?: string | null;
  form_snapshot: unknown; answers: unknown;
}): RegistrationRecord {
  const form = object(row.form_snapshot), answers = object(row.answers);
  const fields = Array.isArray(form.fields) ? form.fields.map(object) : [];
  const record: RegistrationRecord = { id: row.id, submittedAt: row.completed_at || row.created_at,
    title: localized(form.title, { zh: "参与登记", en: "Participation form" }), sections: [] };
  if (row.intake_kind === "generic") {
    record.sections.push({ title: record.title, fields: fields.filter(field => typeof field.id === "string").map(field => {
      const value = answers[String(field.id)];
      const options = Array.isArray(field.options) ? field.options.map(object) : [];
      const option = (id: unknown) => localized(options.find(item => item.id === id)?.label, both(string(id)));
      const translated = Array.isArray(value) ? value.map(option) : [option(value)];
      return { label: localized(field.label, both(String(field.id))), value: {
        zh: translated.map(item => item.zh).filter(Boolean).join("、") || empty.zh,
        en: translated.map(item => item.en).filter(Boolean).join(", ") || empty.en,
      } };
    }) });
    return record;
  }
  const configured = FAMILY_FIELD_IDS.map(id => {
    const saved = fields.find(field => field.id === id);
    const fallback = DEFAULT_FAMILY_FORM.fields.find(field => field.id === id)!;
    return { ...fallback, ...saved, id, label: localized(saved?.label, fallback.label) };
  }).filter(field => field.mode !== "hidden");
  function value(id: string, source: ObjectValue): LocalizedText {
    const item = source[id];
    if (id === "grade") return typeof item === "number" && Number.isInteger(item) && item >= -1 && item <= 12
      ? { zh: choices.zh.grade[item + 2], en: choices.en.grade[item + 2] } : empty;
    if (id === "gender" || id === "relation") {
      const values = id === "gender" ? ["", "female", "male"] : ["", "mother", "father", "guardian"];
      const index = values.indexOf(string(item));
      return index > 0 ? { zh: choices.zh[id][index], en: choices.en[id][index] } : empty;
    }
    if (id === "interests") {
      const field = configured.find(field => field.id === id);
      const options = Array.isArray(field?.options) ? field.options.map(object) : [];
      const selected = Array.isArray(item) ? item.filter(value => typeof value === "string").slice(0, 20) : [];
      const labels = selected.map(id => localized(options.find(option => option.id === id)?.label, both(String(id))));
      return labels.length ? { zh: labels.map(label => label.zh).join("、"), en: labels.map(label => label.en).join(", ") } : empty;
    }
    return string(item) ? both(string(item)) : empty;
  }
  const contact = configured.filter(field => ["parentName", "relation"].includes(field.id));
  if (contact.length) record.sections.push({ title: { zh: "联系人", en: "Contact" },
    fields: contact.map(field => ({ label: field.label, value: value(field.id, answers) })) });
  const children = Array.isArray(answers.children) ? answers.children.slice(0, 10).map(object) : [answers];
  children.forEach((child, index) => record.sections.push({
    title: string(child.childName) ? both(string(child.childName)) : { zh: `参与人 ${index + 1}`, en: `Participant ${index + 1}` },
    fields: configured.filter(field => !["parentName", "relation"].includes(field.id))
      .map(field => ({ label: field.label, value: value(field.id, child) })),
  }));
  return record;
}
