import type { FormQuestion, QuestionAnswers } from "../../lib/form-questions";

Component({
  options: { styleIsolation: "apply-shared" },
  properties: { fields: { type: Array, value: [] }, answers: { type: Object, value: {} }, locale: { type: String, value: "zh" }, disabled: Boolean },
  data: { rows: [] as { id: string; type: string; label: string; required: boolean; value: string; index: number; options: { id: string; label: string; checked: boolean }[] }[], requiredText: "", choose: "" },
  observers: {
    "fields, answers, locale"() {
      const locale = this.data.locale === "en" ? "en" : "zh", answers = this.data.answers as QuestionAnswers;
      const choose = locale === "zh" ? "请选择" : "Choose";
      this.setData({ choose, requiredText: locale === "zh" ? "（必填）" : " (required)", rows: (this.data.fields as FormQuestion[]).map(field => {
        const value = answers[field.id], options = (field.options || []).map(o => ({ id: o.id, label: o.label[locale] || o.label.zh, checked: Array.isArray(value) && value.includes(o.id) }));
        if (field.type === "select") options.unshift({ id: "", label: choose, checked: false });
        return { id: field.id, type: field.type, label: field.label[locale] || field.label.zh, required: field.required,
          value: typeof value === "string" ? value : "", index: Math.max(0, options.findIndex(o => o.id === value)), options };
      }) });
    },
  },
  methods: {
    input(event: WechatMiniprogram.Input) { if (!this.data.disabled) this.triggerEvent("change", { id: String(event.currentTarget.dataset.id), value: event.detail.value }); },
    select(event: WechatMiniprogram.PickerChange) {
      const row = this.data.rows.find(r => r.id === event.currentTarget.dataset.id), option = row?.options[Number(event.detail.value)];
      if (row && option && !this.data.disabled) this.triggerEvent("change", { id: row.id, value: option.id });
    },
    check(event: WechatMiniprogram.CheckboxGroupChange) { if (!this.data.disabled) this.triggerEvent("change", { id: String(event.currentTarget.dataset.id), value: event.detail.value }); },
  },
});
