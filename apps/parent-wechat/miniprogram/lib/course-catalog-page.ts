import { courseCatalog } from "./api";
import type { CourseOffer } from "./api-types";
import { courseCard, courseCatalogLabels, courseFilters, filterCourseOffers, saveCourseFilters } from "./course-catalog";
import { pageData, syncPage, errorText, currentLocale } from "./page";

export function registerCourseCatalogPage(full: boolean) {
  Page({
    data: { ...pageData("discover"), ...courseCatalogLabels("zh"), full, source: [] as CourseOffer[], offers: [] as ReturnType<typeof courseCard>[], stage: "", loaded: false, sheet: "" },
    onShow() { syncPage(this, "discover"); this.setData(courseFilters()); this.applyFilters(); void this.load(); },
    onHide() { this.setData({ sheet: "" }); },
    async load() {
      if (this.data.loading) return;
      this.setData({ loading: true, error: "" });
      try { const source = await courseCatalog(); this.setData({ source, loaded: true }); this.applyFilters(); }
      catch (error) { this.setData({ error: errorText(error) }); }
      finally { this.setData({ loading: false }); }
    },
    applyFilters() { this.setData({ ...courseCatalogLabels(currentLocale(), this.data.stage), offers: filterCourseOffers(this.data.source, this.data.stage).map(r => courseCard(r, currentLocale())) }); },
    showFilter() { this.setData({ sheet: "stage" }); },
    closeSheet() { this.setData({ sheet: "" }); }, noop() {},
    chooseFilter(e: WechatMiniprogram.TouchEvent) { this.setData({ stage: String(e.currentTarget.dataset.value || ""), sheet: "" }); saveCourseFilters(this.data); this.applyFilters(); },
    reset() { this.setData({ stage: "" }); saveCourseFilters(this.data); this.applyFilters(); },
    showAll() { wx.navigateTo({ url: "/pages/course-catalog/index" }); },
    book() { wx.navigateTo({ url: "/pages/assessment/index" }); },
    advisor() { wx.navigateTo({ url: "/pages/advisor/index?stage=" + encodeURIComponent(this.data.stage) }); },
    applications() { wx.navigateTo({ url: "/pages/course-applications/index" }); },
    openCourse(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: "/pages/course-detail/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) }); },
  });
}
