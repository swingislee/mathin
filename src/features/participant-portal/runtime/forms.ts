import type { ExperienceField, ExperienceForm } from "../../../../contracts/participant-api/miniapp-experience";
import type { RuntimeField, RuntimeFormGroup, RuntimeLocale } from "../../../../contracts/participant-api/runtime";

const local = (value: { zh: string; en: string } | undefined, locale: RuntimeLocale) => value?.[locale] || value?.zh || value?.en || "";

/** One question of the form library in the runtime field shape every client renders. */
export function runtimeField(field: ExperienceField, locale: RuntimeLocale): RuntimeField {
  const choice = field.type === "select" || field.type === "multiselect";
  return {
    id: field.id, kind: field.type, label: local(field.label, locale), help: local(field.help, locale), placeholder: local(field.placeholder, locale),
    required: field.required, display: field.display ?? (field.type === "multiselect" ? "pills" : "picker"),
    options: choice ? field.options.map(option => ({ value: option.id, label: local(option.label, locale), hint: "", badge: "", disabled: false })) : [],
    min: field.min ?? null, max: field.type === "rating" ? field.max ?? 5 : field.max ?? null,
    accept: field.type === "media" ? field.accept ?? ["image"] : [],
    visibleWhen: field.visibleWhen ? { field: field.visibleWhen.fieldId, operator: field.visibleWhen.operator, value: field.visibleWhen.value } : null,
  };
}
export function runtimeFormGroups(form: ExperienceForm, locale: RuntimeLocale): RuntimeFormGroup[] {
  return form.groups.map(group => ({ id: group.id, title: local(group.title, locale), description: local(group.description, locale),
    repeat: group.repeat, min: group.minEntries, max: group.repeat ? group.maxEntries : 1, fields: group.fields.map(field => runtimeField(field, locale)) }));
}
