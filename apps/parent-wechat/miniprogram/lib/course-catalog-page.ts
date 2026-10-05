import { courseCatalog } from "./api";
import type { CourseOffer } from "./api-types";
import { courseCard, courseCatalogLabels, courseFilters, filterCourseOffers, saveCourseFilters } from "./course-catalog";
import { pageData, syncPage, errorText, currentLocale } from "./page";

export function registerCourseCatalogPage(full: boolean) {
  Page({
    data: { ...pageData("discover"), ...courseCatalogLabels([], "", "", "zh"), full,
      source: [] as CourseOffer[], offers: [] as ReturnType<typeof courseCard>[], stage: "", subject: "", term: "", termLabel: "",
      terms: [] as { id: string; label: string }[], loaded: false, sheet: "" },
    onShow() { syncPage(this, "discover"); this.setData(courseFilters()); this.applyFilters(); void this.load(); },
    onHide() { this.setData({ sheet: "" }); },
    async load() {
      if (this.data.loading) return;
      this.setData({ loading: true, error: "" });
      try {
        const source = await courseCatalog();
        const terms = source.map(r => ({ id: r.classes[0].termId, label: r.classes[0].termName })).filter((t, i, all) => all.findIndex(v => v.id === t.id) === i);
        this.setData({ source, terms, loaded: true }); this.applyFilters();
      } catch (error) { this.setData({ error: errorText(error) }); }
      finally { this.setData({ loading: false }); }
    },
    applyFilters() {
      this.setData({ ...courseCatalogLabels(this.data.source, this.data.stage, this.data.subject, currentLocale()),
        termLabel: this.data.terms.find(t => t.id === this.data.term)?.label || "",
        offers: filterCourseOffers(this.data.source, this.data.stage, this.data.subject, this.data.term).map(r => courseCard(r, currentLocale())) });
    },
    showFilter(e: WechatMiniprogram.TouchEvent) { const sheet = String(e.currentTarget.dataset.sheet); if (["stage", "subject", "term"].includes(sheet)) this.setData({ sheet }); },
    closeSheet() { this.setData({ sheet: "" }); }, noop() {},
    chooseFilter(e: WechatMiniprogram.TouchEvent) {
      const key = this.data.sheet; if (!["stage", "subject", "term"].includes(key)) return;
      this.setData({ [key]: String(e.currentTarget.dataset.value || ""), sheet: "" }); saveCourseFilters(this.data); this.applyFilters();
    },
    reset() { this.setData({ stage: "", subject: "", term: "" }); saveCourseFilters(this.data); this.applyFilters(); },
    showAll() { wx.navigateTo({ url: "/pages/course-catalog/index" }); },
    register() { wx.navigateTo({ url: "/pages/register/index?source=discover" }); },
    reservations() { wx.navigateTo({ url: "/pages/reservations/index" }); },
    book() { wx.navigateTo({ url: "/pages/assessment/index" }); },
    openCourse(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: "/pages/course-detail/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) }); },
  });
}
