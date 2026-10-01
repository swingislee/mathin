import { get } from "../../lib/api";
import type { Activity } from "../../lib/api-types";
import { filterActivities, canReserve, type DateFilter } from "../../lib/discovery";
import { pageData, syncPage, text, date, errorText, currentLocale } from "../../lib/page";

Page({
  data: {
    ...pageData("discover"), source: [] as Activity[],
    activities: [] as (Activity & { label: string; body: string; when: string; open: boolean })[],
    search: "", location: "", locationIndex: 0, locations: [] as string[],
    period: "all" as DateFilter, availableOnly: false, loaded: false,
  },
  onShow() { syncPage(this, "discover"); this.applyFilters(); void this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const rows = await get<Activity[]>("activities", "", false);
      const locations = [this.data.copy.allLocations, ...Array.from(new Set(rows.map(row => row.location).filter(Boolean)))];
      const locationIndex = Math.max(0, locations.indexOf(this.data.location));
      this.setData({ source: rows, locations, locationIndex, location: locationIndex ? locations[locationIndex] : "", loaded: true });
      this.applyFilters();
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  applyFilters() {
    const rows = filterActivities(this.data.source, this.data, currentLocale());
    this.setData({ activities: rows.map(row => ({ ...row, label: text(row.title), body: text(row.description), when: date(row.startsAt), open: canReserve(row) })) });
  },
  search(e: WechatMiniprogram.Input) { this.setData({ search: e.detail.value }); this.applyFilters(); },
  location(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({ locationIndex: index, location: index ? this.data.locations[index] : "" }); this.applyFilters();
  },
  period(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value as DateFilter;
    if (["all", "week", "month"].includes(value)) { this.setData({ period: value }); this.applyFilters(); }
  },
  available(e: WechatMiniprogram.SwitchChange) { this.setData({ availableOnly: e.detail.value }); this.applyFilters(); },
  reset() { this.setData({ search: "", location: "", locationIndex: 0, period: "all", availableOnly: false }); this.applyFilters(); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=discover" }); },
  reservations() { wx.switchTab({ url: "/pages/reservations/index" }); },
  openActivity(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: "/pages/activity/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) });
  },
});
