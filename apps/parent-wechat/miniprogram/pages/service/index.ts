import { contactCard } from "../../lib/contact-card";
import { configuredPage } from "../../lib/native-page";
import { serviceContacts } from "../../lib/api";
import type { ServiceContact } from "../../lib/api-types";
import { catalogStages } from "../../lib/catalog";
import { miniappText } from "../../lib/miniapp-settings";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
const words = {
  zh: { title: "联系服务", stageNumber: "选择参与者阶段", service: "服务人员", scan: "长按二维码添加服务人员微信", phone: "拨打电话", missing: "该阶段的服务联系方式尚未设置。", save: "查看二维码", campus: "服务校区", allCampuses: "所有校区", hours: "服务时间", address: "服务地址" },
  en: { title: "Contact service", stageNumber: "Participant stage", service: "Service contact", scan: "Long press the QR code to add the contact on WeChat", phone: "Call service", missing: "Contact details are not configured for this stage yet.", save: "View QR code", campus: "Campus", allCampuses: "All campuses", hours: "Service hours", address: "Address" },
};
type ContactRow = ReturnType<typeof contactCard>;
configuredPage("service")({
  source: [] as ServiceContact[], requestVersion: 0,
  data: { ...pageData("discover"), t: words.zh, stageNumber: 1, selected: 0, stages: [] as { stageNumber: number; label: string }[],
    contacts: [] as ContactRow[], campusId: "", campusSelected: 0, campuses: [] as { id: string; name: string }[] },
  onLoad(query: Record<string, string>) {
    const stageNumber = catalogStages(true).find(s => s.id === query.stage)?.stageNumber;
    if (stageNumber !== undefined) this.setData({ stageNumber });
  },
  onShow() { syncPage(this, "discover"); this.render(); void this.load(); },
  configurationChanged() { this.render(); void this.load(); },
  onHide() { this.requestVersion++; },
  onUnload() { this.requestVersion++; },
  async load() {
    const version = ++this.requestVersion;
    this.setData({ loading: true, error: "" });
    try { const rows = await serviceContacts(this.data.stageNumber); if (version !== this.requestVersion) return; this.source = rows; this.render(); }
    catch (error) { if (version !== this.requestVersion) return; this.source = []; this.setData({ contacts: [], error: errorText(error) }); }
    finally { if (version === this.requestVersion) this.setData({ loading: false }); }
  },
  render() {
    const locale = currentLocale(), stages = catalogStages().map(s => ({ stageNumber: s.stageNumber, label: s.label[locale] || s.label.zh }));
    if (!stages.some(s => s.stageNumber === this.data.stageNumber)) { const current = catalogStages(true).find(s => s.stageNumber === this.data.stageNumber); if (current) stages.push({ stageNumber: current.stageNumber, label: current.label[locale] || current.label.zh }); }
    const rows = this.source.filter(r => r.stageNumber === this.data.stageNumber), campuses = [{ id: "", name: words[locale].allCampuses }];
    rows.forEach(r => { if (r.campusId && !campuses.some(c => c.id === r.campusId)) campuses.push({ id: r.campusId, name: r.campusName || "" }); });
    const campusId = campuses.some(c => c.id === this.data.campusId) ? this.data.campusId : "";
    const contacts = rows.filter(r => !campusId || !r.campusId || r.campusId === campusId).map(r => contactCard(r, locale));
    this.setData({ t: words[locale], stages, selected: Math.max(0, stages.findIndex(s => s.stageNumber === this.data.stageNumber)), contacts, campusId, campuses, campusSelected: campuses.findIndex(c => c.id === campusId) });
  },
  change(e: WechatMiniprogram.PickerChange) { const row = this.data.stages[Number(e.detail.value)]; if (row) { this.setData({ stageNumber: row.stageNumber }); this.render(); void this.load(); } },
  changeCampus(e: WechatMiniprogram.PickerChange) { const row = this.data.campuses[Number(e.detail.value)]; if (row) { this.setData({ campusId: row.id }); this.render(); } },
});
