import { get } from "../../lib/api";
import type { Activity } from "../../lib/api-types";
import { filterActivities, canReserve, type DateFilter } from "../../lib/discovery";
import { pageData, syncPage, text, date, errorText, currentLocale } from "../../lib/page";

Page({
  data: {
    ...pageData("discover"), source: [] as Activity[],
    activities: [] as (Activity & { label: string; when: string; open: boolean })[],
    search: "", location: "", locations: [] as string[], period: "all" as DateFilter,
    availableOnly: false, loaded: false, sheet: "", showAll: false,
  },
  onShow() { syncPage(this, "discover"); this.applyFilters(); void this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const rows = await get<Activity[]>("activities", "", false);
      const locations = Array.from(new Set(rows.map(row => row.location).filter(Boolean)));
      this.setData({ source: rows, locations, location: locations.includes(this.data.location) ? this.data.location : "", loaded: true });
      this.applyFilters();
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  applyFilters() {
    const rows = filterActivities(this.data.source, this.data, currentLocale());
    this.setData({ activities: rows.map(row => ({ ...row, label: text(row.title), when: date(row.startsAt), open: canReserve(row) })) });
  },
  showFilter(e: WechatMiniprogram.TouchEvent) { this.setData({ sheet: String(e.currentTarget.dataset.sheet) }); },
  closeSheet() { this.setData({ sheet: "" }); },
  noop() {},
  location(e: WechatMiniprogram.TouchEvent) {
    const location = String(e.currentTarget.dataset.value || "");
    if (location && !this.data.locations.includes(location)) return;
    this.setData({ location, sheet: "" }); this.applyFilters();
  },
  period(e: WechatMiniprogram.TouchEvent) {
    const period = e.currentTarget.dataset.value as DateFilter;
    if (["all", "week", "month"].includes(period)) { this.setData({ period, sheet: "" }); this.applyFilters(); }
  },
  reset() { this.setData({ search: "", location: "", period: "all", availableOnly: false }); this.applyFilters(); },
  showAll() { this.setData({ showAll: !this.data.showAll }); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=discover" }); },
  reservations() { wx.navigateTo({ url: "/pages/reservations/index" }); },
  book() { wx.navigateTo({ url: "/pages/assessment/index" }); },
  openActivity(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: "/pages/activity/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) });
  },
});
