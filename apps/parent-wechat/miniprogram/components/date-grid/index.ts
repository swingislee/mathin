type Day = { key?: string; date: string; day: string | number; today?: boolean; selected?: boolean; count?: number; weekday?: number };
Component({
  properties: { days: { type: Array, value: [] as Day[] }, weekdays: { type: Array, value: [] as (string | { label: string; key: number })[] }, mode: { type: String, value: "month" }, todayLabel: String, disabled: Boolean },
  data: { headers: [] as { key: number; label: string }[], dates: [] as (Day & { weekdayText: string })[] },
  observers: { "days, weekdays"() { const headers = this.data.weekdays.map((v, key) => ({ key, label: typeof v === "string" ? v : v.label })); this.setData({ headers, dates: this.data.days.map((d, i) => ({ ...d, key: d.key || d.date || String(i), weekdayText: headers[d.weekday || 0]?.label || "" })) }); } },
  methods: { choose(e: WechatMiniprogram.TouchEvent) { const date = String(e.currentTarget.dataset.date || ""); if (!this.data.disabled && date && this.data.days.some(d => d.date === date)) this.triggerEvent("select", { date }); } },
});
