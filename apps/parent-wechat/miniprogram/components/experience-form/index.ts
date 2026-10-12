import { fieldIsVisible, localText, type ExperienceAnswers, type ExperienceForm, type ExperienceFieldAnswers } from "../../lib/miniapp-experience";
type FieldRow = { id: string; type: string; label: string; help: string; placeholder: string; required: boolean; value: string; error: boolean; selected: number; options: { id: string; label: string; checked: boolean }[] };
type GroupRow = { id: string; title: string; description: string; repeat: boolean; canAdd: boolean; canRemove: boolean; rows: { index: number; fields: FieldRow[] }[] };
Component({
  properties: { form: { type: Object, value: null as ExperienceForm | null }, answers: { type: Object, value: {} as ExperienceAnswers }, locale: { type: String, value: "zh" }, errors: { type: Array, value: [] as string[] }, disabled: Boolean },
  data: { groups: [] as GroupRow[] },
  observers: { "form, answers, locale, errors"() { this.render(); } },
  methods: {
    render() { const f = this.properties.form as ExperienceForm | null, locale = this.properties.locale === "en" ? "en" : "zh"; if (!f) { this.setData({ groups: [] }); return; }
      this.setData({ groups: f.groups.map(group => { const rows = this.properties.answers[group.id] || [];
        return { id: group.id, title: localText(group.title, locale), description: localText(group.description, locale), repeat: group.repeat, canAdd: rows.length < group.maxEntries, canRemove: rows.length > group.minEntries,
          rows: rows.map((row, index) => ({ index, fields: group.fields.filter(field => fieldIsVisible(field, row)).map(field => { const raw = row[field.id];
            return { id: field.id, type: field.type, label: localText(field.label, locale), help: localText(field.help, locale), placeholder: localText(field.placeholder, locale), required: field.required, value: typeof raw === "string" ? raw : "",
              error: this.properties.errors.includes(`${group.id}.${index}.${field.id}`), selected: Math.max(0, field.options.findIndex(o => o.id === raw) + 1),
              options: [{ id: "", label: locale === "en" ? "Choose" : "请选择", checked: false }, ...field.options.map(o => ({ id: o.id, label: localText(o.label, locale), checked: Array.isArray(raw) && raw.includes(o.id) }))] };
          }) })) };
      }) });
    },
    change(e: WechatMiniprogram.CustomEvent<{ value: string | string[] }>) { if (this.properties.disabled) return; const { group: groupId, row: rowIndex, field: fieldId } = e.currentTarget.dataset;
      const group = (this.properties.form as ExperienceForm | null)?.groups.find(g => g.id === groupId), field = group?.fields.find(f => f.id === fieldId), index = Number(rowIndex); if (!group || !field || !Number.isInteger(index)) return;
      let value = e.detail.value;
      if (field.type === "select") value = field.options[Number(value) - 1]?.id || "";
      if (field.type === "consent") value = Array.isArray(value) && value.includes("yes") ? "yes" : "";
      if (!this.properties.answers[group.id]?.[index]) return;
      const answers = { ...this.properties.answers, [group.id]: this.properties.answers[group.id].map((r, i) => i === index ? { ...r, [field.id]: value } : r) };
      this.triggerEvent("change", { answers });
    },
    add(e: WechatMiniprogram.TouchEvent) { if (this.properties.disabled) return; const group = (this.properties.form as ExperienceForm | null)?.groups.find(g => g.id === e.currentTarget.dataset.group); if (!group?.repeat) return;
      const rows = this.properties.answers[group.id] || []; if (rows.length < group.maxEntries) this.triggerEvent("change", { answers: { ...this.properties.answers, [group.id]: [...rows, {} as ExperienceFieldAnswers] } });
    },
    remove(e: WechatMiniprogram.TouchEvent) { if (this.properties.disabled) return; const group = (this.properties.form as ExperienceForm | null)?.groups.find(g => g.id === e.currentTarget.dataset.group); if (!group?.repeat) return;
      const rows = this.properties.answers[group.id] || []; if (rows.length > group.minEntries) this.triggerEvent("change", { answers: { ...this.properties.answers, [group.id]: rows.filter((_, i) => i !== Number(e.currentTarget.dataset.row)) } });
    },
  },
});
