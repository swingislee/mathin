import { fieldIsVisible, localText, type ExperienceAnswers, type ExperienceField, type ExperienceForm } from "../../lib/miniapp-experience";
import { currentApp } from "../../lib/runtime";
import type { RuntimeField } from "../../lib/runtime-contract";
type FieldRow = { key: string; field: RuntimeField; value: string | string[]; error: boolean };
type GroupRow = { id: string; title: string; description: string; repeat: boolean; canAdd: boolean; canRemove: boolean; rows: { index: number; fields: FieldRow[] }[] };

/** The form library question in the shape the shared field renderer draws. */
function runtimeField(field: ExperienceField, locale: "zh" | "en"): RuntimeField {
  const choice = field.type === "select" || field.type === "multiselect";
  return { id: field.id, kind: field.type, label: localText(field.label, locale), help: localText(field.help, locale), placeholder: localText(field.placeholder, locale),
    required: field.required, display: field.display ?? (field.type === "multiselect" ? "pills" : "picker"),
    options: choice ? field.options.map(option => ({ value: option.id, label: localText(option.label, locale), hint: "", badge: "", disabled: false })) : [],
    min: field.min ?? null, max: field.type === "rating" ? field.max ?? 5 : field.max ?? null, accept: field.type === "media" ? field.accept ?? ["image"] : [], visibleWhen: null };
}

Component({
  properties: { form: { type: Object, value: null as ExperienceForm | null }, answers: { type: Object, value: {} as ExperienceAnswers }, locale: { type: String, value: "zh" }, errors: { type: Array, value: [] as string[] }, disabled: Boolean },
  data: { groups: [] as GroupRow[], strings: currentApp().strings },
  observers: { "form, answers, locale, errors"() { this.render(); } },
  methods: {
    render() {
      const f = this.properties.form as ExperienceForm | null, locale = this.properties.locale === "en" ? "en" : "zh";
      if (!f) { this.setData({ groups: [] }); return; }
      this.setData({ strings: currentApp().strings, groups: f.groups.map(group => {
        const rows = this.properties.answers[group.id] || [];
        return { id: group.id, title: localText(group.title, locale), description: localText(group.description, locale), repeat: group.repeat, canAdd: rows.length < group.maxEntries, canRemove: rows.length > group.minEntries,
          rows: rows.map((row, index) => ({ index, fields: group.fields.filter(field => fieldIsVisible(field, row)).map(field => {
            const raw = row[field.id], list = field.type === "multiselect" || field.type === "media";
            return { key: field.id, field: runtimeField(field, locale), value: raw ?? (list ? [] : ""), error: this.properties.errors.includes(`${group.id}.${index}.${field.id}`) };
          }) })) };
      }) });
    },
    change(e: WechatMiniprogram.CustomEvent<{ value: string | string[] }>) {
      if (this.properties.disabled) return;
      const { group: groupId, row: rowIndex, field: fieldId } = e.currentTarget.dataset;
      const group = (this.properties.form as ExperienceForm | null)?.groups.find(g => g.id === groupId), field = group?.fields.find(f => f.id === fieldId), index = Number(rowIndex);
      if (!group || !field || !Number.isInteger(index) || !this.properties.answers[group.id]?.[index]) return;
      const answers = { ...this.properties.answers, [group.id]: this.properties.answers[group.id].map((r, i) => i === index ? { ...r, [field.id]: e.detail.value } : r) };
      this.triggerEvent("change", { answers });
    },
    add(e: WechatMiniprogram.TouchEvent) { if (this.properties.disabled) return; const group = (this.properties.form as ExperienceForm | null)?.groups.find(g => g.id === e.currentTarget.dataset.group); if (!group?.repeat) return;
      const rows = this.properties.answers[group.id] || []; if (rows.length < group.maxEntries) this.triggerEvent("change", { answers: { ...this.properties.answers, [group.id]: [...rows, {}] } });
    },
    remove(e: WechatMiniprogram.TouchEvent) { if (this.properties.disabled) return; const group = (this.properties.form as ExperienceForm | null)?.groups.find(g => g.id === e.currentTarget.dataset.group); if (!group?.repeat) return;
      const rows = this.properties.answers[group.id] || []; if (rows.length > group.minEntries) this.triggerEvent("change", { answers: { ...this.properties.answers, [group.id]: rows.filter((_, i) => i !== Number(e.currentTarget.dataset.row)) } });
    },
  },
});
