type ParticipantOption = { id: string; name: string };
Component({
  properties: { rows: { type: Array, value: [] as ParticipantOption[] }, selected: Number, selectedIds: { type: Array, value: [] as string[] }, multiple: Boolean, disabled: Boolean, placeholder: String, label: String, subtitle: String, mode: { type: String, value: "picker" } },
  data: { options: [] as (ParticipantOption & { checked: boolean })[] },
  observers: { "rows, selectedIds"() { this.setData({ options: this.data.rows.map(row => ({ ...row, checked: this.data.selectedIds.includes(row.id) })) }); } },
  methods: {
    pick(e: WechatMiniprogram.PickerChange) { const value = Number(e.detail.value); if (!this.data.disabled && this.data.rows[value]) this.triggerEvent("change", { value }); },
    choose(e: WechatMiniprogram.TouchEvent) { const value = Number(e.currentTarget.dataset.index); if (!this.data.disabled && this.data.rows[value]) this.triggerEvent("change", { value }); },
    check(e: WechatMiniprogram.CheckboxGroupChange) { if (!this.data.disabled) this.triggerEvent("change", { value: e.detail.value.filter(id => this.data.rows.some(row => row.id === id)) }); },
    empty() { if (!this.data.disabled) this.triggerEvent("empty"); },
  },
});
