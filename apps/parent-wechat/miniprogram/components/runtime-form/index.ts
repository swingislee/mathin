import { ApiError, session } from "../../lib/api";
import { runCommand, runtimeContextMarker } from "../../lib/runtime";
import { runtimeParamsKey, type RuntimeAnswers, type RuntimeBlockView, type RuntimeField, type RuntimeFormGroup } from "../../lib/runtime-contract";

type Form = Extract<RuntimeBlockView, { type: "form" }>;
type Row = Record<string, string | string[]>;
type FieldRow = { key: string; field: RuntimeField; value: string | string[]; error: boolean };
type GroupRow = { id: string; title: string; description: string; repeat: boolean; canAdd: boolean; canRemove: boolean; rows: { index: number; fields: FieldRow[] }[] };

const empty = (value: unknown) => value === undefined || (Array.isArray(value) ? !value.length : typeof value !== "string" || !value.trim());
function visible(field: RuntimeField, row: Row) {
  const rule = field.visibleWhen;
  if (!rule) return true;
  const answer = row[rule.field];
  if (rule.operator === "answered") return !empty(answer);
  if (rule.operator === "includes") return Array.isArray(answer) && answer.includes(rule.value);
  return rule.operator === "equals" ? answer === rule.value : answer !== rule.value;
}
function initial(groups: RuntimeFormGroup[]): RuntimeAnswers {
  const answers: RuntimeAnswers = {};
  for (const group of groups) answers[group.id] = Array.from({ length: Math.max(1, group.min) }, () => ({}));
  return answers;
}

// A form from the Mini Program form library. Answers stay here until Mathin accepts them; the effects that come back are passed to the page.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} }, screen: { type: String, value: "" }, screenParams: { type: Object, value: {} } },
  data: { answers: {} as RuntimeAnswers, errors: [] as string[], groups: [] as GroupRow[], busy: false, formKey: "" },
  observers: {
    "block, screenParams"(block: Form) {
      // A changed form definition starts a new set of answers; refreshing the same form keeps what was typed.
      const key = block.id + ":" + JSON.stringify(block.groups || []) + ":" + (block.params?.revision || "") + ":" + runtimeContextMarker() + ":" + runtimeParamsKey(this.data.screenParams);
      if (key !== this.data.formKey) this.setData({ formKey: key, answers: initial(block.groups || []), errors: [] });
      this.render();
    },
  },
  methods: {
    render() {
      const block = this.data.block as Form, answers = this.data.answers;
      this.setData({ groups: (block.groups || []).map(group => {
        const rows = answers[group.id] || [];
        return { id: group.id, title: group.title, description: group.description, repeat: group.repeat, canAdd: group.repeat && rows.length < group.max, canRemove: group.repeat && rows.length > Math.max(1, group.min),
          rows: rows.map((row, index) => ({ index, fields: group.fields.filter(field => visible(field, row)).map(field => ({ key: field.id, field, value: row[field.id] ?? (field.kind === "multiselect" || field.kind === "media" ? [] : ""),
            error: this.data.errors.includes(`${group.id}.${index}.${field.id}`) })) })) };
      }) });
    },
    change(e: WechatMiniprogram.CustomEvent<{ value: string | string[] }>) {
      const { group, row, field } = e.currentTarget.dataset as { group: string; row: number; field: string };
      const rows = [...(this.data.answers[group] || [])], index = Number(row);
      if (!rows[index]) return;
      rows[index] = { ...rows[index], [field]: e.detail.value };
      this.setData({ answers: { ...this.data.answers, [group]: rows }, errors: this.data.errors.filter(path => path !== `${group}.${index}.${field}`) });
      this.render();
    },
    add(e: WechatMiniprogram.TouchEvent) {
      const group = String(e.currentTarget.dataset.group);
      this.setData({ answers: { ...this.data.answers, [group]: [...(this.data.answers[group] || []), {}] } });
      this.render();
    },
    remove(e: WechatMiniprogram.TouchEvent) {
      const group = String(e.currentTarget.dataset.group), index = Number(e.currentTarget.dataset.row);
      this.setData({ answers: { ...this.data.answers, [group]: (this.data.answers[group] || []).filter((_, i) => i !== index) } });
      this.render();
    },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
    async submit() {
      if (this.data.busy) return;
      if (!session()) { this.login(); return; }
      const block = this.data.block as Form, strings = this.data.strings as Record<string, string>;
      const errors: string[] = [], values: RuntimeAnswers = {};
      for (const group of block.groups) values[group.id] = (this.data.answers[group.id] || []).map((row, index) => {
        const clean: Row = {};
        for (const field of group.fields) {
          if (!visible(field, row)) continue;
          if (empty(row[field.id])) { if (field.required) errors.push(`${group.id}.${index}.${field.id}`); continue; }
          clean[field.id] = row[field.id];
        }
        return clean;
      });
      if (errors.length) { this.setData({ errors }); this.render(); wx.showToast({ title: strings.required, icon: "none" }); return; }
      this.setData({ busy: true });
      const marker = runtimeContextMarker(), formKey = this.data.formKey;
      try {
        const effects = await runCommand(block.command, block.params || {}, { screen: this.data.screen, block: block.id, values, params: this.data.screenParams });
        if (marker !== runtimeContextMarker() || formKey !== this.data.formKey) return;
        if (effects.some(effect => effect.type === "reset")) { this.setData({ answers: initial(block.groups), errors: [] }); this.render(); }
        this.triggerEvent("effects", { effects: effects.filter(effect => effect.type !== "reset"), after: block.after });
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "";
        if (marker !== runtimeContextMarker() || formKey !== this.data.formKey || code === "CONTEXT_CHANGED") return;
        if (code === "FORM_CHANGED") this.triggerEvent("effects", { effects: [{ type: "toast", text: strings.unavailable }, { type: "refresh", blocks: [block.id] }], after: null });
        else if (code === "UPDATE_REQUIRED") wx.showToast({ title: strings.updateRequired, icon: "none" });
        else wx.showToast({ title: code === "RATE_LIMIT" || code === "UNAVAILABLE" || code === "NETWORK" ? strings.unavailable : strings.required, icon: "none" });
      } finally { this.setData({ busy: false }); }
    },
  },
});
