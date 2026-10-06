import { advisorContacts } from "../../lib/api";
import type { AdvisorContact } from "../../lib/api-types";
import { stageGroups } from "../../lib/catalog";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
const words = {
  zh: { title: "联系学服", grade: "选择学员年级", advisor: "学服老师", scan: "长按二维码添加老师微信", phone: "拨打手机号", missing: "该年级的学服联系方式尚未设置。", save: "查看二维码" },
  en: { title: "Contact advisor", grade: "Student grade", advisor: "Learning advisor", scan: "Long press the QR code to add the advisor on WeChat", phone: "Call advisor", missing: "Advisor contact details are not configured for this grade yet.", save: "View QR code" },
};
Page({
  data: { ...pageData("discover"), t: words.zh, grade: 1, selected: 0, stages: [] as { grade: number; label: string }[],
    rows: [] as AdvisorContact[], contact: null as AdvisorContact | null },
  onLoad(query: Record<string, string>) {
    const stages = stageGroups.reduce((all, g) => all.concat(g.stages), [] as typeof stageGroups[0]["stages"]); const grade = stages.find(s => s.id === query.stage)?.grade;
    if (grade !== undefined) this.setData({ grade });
  },
  onShow() { syncPage(this, "discover"); this.render(); void this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try { this.setData({ rows: await advisorContacts() }); this.render(); }
    catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  render() {
    const locale = currentLocale(), stages = stageGroups.reduce((all, g) => all.concat(g.stages), [] as typeof stageGroups[0]["stages"]).map(s => ({ grade: s.grade, label: s.label[locale] }));
    this.setData({ t: words[locale], stages, selected: Math.max(0, stages.findIndex(s => s.grade === this.data.grade)), contact: this.data.rows.find(r => r.grade === this.data.grade) || null });
  },
  change(e: WechatMiniprogram.PickerChange) { const row = this.data.stages[Number(e.detail.value)]; if (row) { this.setData({ grade: row.grade }); this.render(); } },
  phone() { if (this.data.contact) wx.makePhoneCall({ phoneNumber: this.data.contact.phone.replace(/[ -]/g, "") }); },
  preview() { if (this.data.contact) wx.previewImage({ urls: [this.data.contact.qrCodeUrl] }); },
});
