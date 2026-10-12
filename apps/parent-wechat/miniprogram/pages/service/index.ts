import { serviceContacts } from "../../lib/api";
import type { ServiceContact } from "../../lib/api-types";
import { catalogStages } from "../../lib/catalog";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
const words = {
  zh: { title: "联系服务", stageNumber: "选择参与者阶段", service: "服务人员", scan: "长按二维码添加服务人员微信", phone: "拨打手机号", missing: "该阶段的服务联系方式尚未设置。", save: "查看二维码" },
  en: { title: "Contact service", stageNumber: "Participant stage", service: "Service contact", scan: "Long press the QR code to add the contact on WeChat", phone: "Call service", missing: "Contact details are not configured for this stage yet.", save: "View QR code" },
};
Page({
  data: { ...pageData("discover"), t: words.zh, stageNumber: 1, selected: 0, stages: [] as { stageNumber: number; label: string }[],
    rows: [] as ServiceContact[], contact: null as ServiceContact | null },
  onLoad(query: Record<string, string>) {
    const stageNumber = catalogStages(true).find(s => s.id === query.stage)?.stageNumber;
    if (stageNumber !== undefined) this.setData({ stageNumber });
  },
  onShow() { syncPage(this, "discover"); this.render(); void this.load(); },
  configurationChanged() { this.render(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try { this.setData({ rows: await serviceContacts() }); this.render(); }
    catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  render() {
    const locale = currentLocale(), stages = catalogStages().map(s => ({ stageNumber: s.stageNumber, label: s.label[locale] || s.label.zh }));
    this.setData({ t: words[locale], stages, selected: Math.max(0, stages.findIndex(s => s.stageNumber === this.data.stageNumber)), contact: this.data.rows.find(r => r.stageNumber === this.data.stageNumber) || null });
  },
  change(e: WechatMiniprogram.PickerChange) { const row = this.data.stages[Number(e.detail.value)]; if (row) { this.setData({ stageNumber: row.stageNumber }); this.render(); } },
  phone() { if (this.data.contact) wx.makePhoneCall({ phoneNumber: this.data.contact.phone.replace(/[ -]/g, "") }); },
  preview() { if (this.data.contact) wx.previewImage({ urls: [this.data.contact.qrCodeUrl] }); },
});
