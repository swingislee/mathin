import { get } from "../../lib/api";
import type { Activity } from "../../lib/api-types";
import { canReserve } from "../../lib/discovery";
import { catalogLabels, filterCatalog, normalizeFilters, readCatalogFilters, saveCatalogFilters } from "../../lib/catalog";
import { pageData, syncPage, text, date, errorText, currentLocale } from "../../lib/page";

Page({
  data: {
    ...pageData("discover"), source: [] as Activity[],
    activities: [] as (Activity & { label: string; when: string; open: boolean })[],
    stage: "", subject: "", ...catalogLabels("", "", "zh"),
    loaded: false, sheet: "", showAll: false,
  },
  onShow() { syncPage(this, "discover"); this.setData(readCatalogFilters()); this.applyFilters(); void this.load(); },
  onHide() { this.setData({ sheet: "" }); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const rows = await get<Activity[]>("activities", "", false);
      this.setData({ source: rows, loaded: true });
      this.applyFilters();
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  applyFilters() {
    const rows = filterCatalog(this.data.source, this.data.stage, this.data.subject);
    this.setData({ ...catalogLabels(this.data.stage, this.data.subject, currentLocale()),
      activities: rows.map(row => ({ ...row, label: text(row.title), when: date(row.startsAt), open: canReserve(row) })) });
  },
  showFilter(e: WechatMiniprogram.TouchEvent) {
    const sheet = String(e.currentTarget.dataset.sheet);
    if (sheet === "stage" || sheet === "subject") this.setData({ sheet });
  },
  closeSheet() { this.setData({ sheet: "" }); },
  noop() {},
  chooseFilter(e: WechatMiniprogram.TouchEvent) {
    const key = this.data.sheet;
    if (key !== "stage" && key !== "subject") return;
    const filters = normalizeFilters({ stage: this.data.stage, subject: this.data.subject, [key]: String(e.currentTarget.dataset.value || "") });
    this.setData({ ...filters, sheet: "", showAll: false }); saveCatalogFilters(filters); this.applyFilters();
  },
  reset() { this.setData({ stage: "", subject: "", showAll: false }); saveCatalogFilters(this.data); this.applyFilters(); },
  showAll() { this.setData({ showAll: !this.data.showAll }); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=discover" }); },
  reservations() { wx.navigateTo({ url: "/pages/reservations/index" }); },
  book() { wx.navigateTo({ url: "/pages/assessment/index" }); },
  openActivity(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: "/pages/activity/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) });
  },
});
