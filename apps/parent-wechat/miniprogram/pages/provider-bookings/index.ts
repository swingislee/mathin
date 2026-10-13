import { configuredPage } from "../../lib/native-page";
import { experienceRequest, requestId, session } from "../../lib/api";
import type { ExperienceRemoteBooking } from "../../lib/experience-runtime";
import { localText } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale, date, errorText, loginPage } from "../../lib/page";
const names = { requested: ["待确认", "Requested"], confirmed: ["已确认", "Confirmed"], cancelled: ["已取消", "Cancelled"], completed: ["已完成", "Completed"], noShow: ["未到场", "No show"], waitlisted: ["候补中", "Waiting list"] };
type Row = ExperienceRemoteBooking & { title: string; when: string; label: string };
configuredPage("provider-bookings")({
  data: { ...pageData("discover"), rows: [] as Row[], authenticated: false, busy: false, page: 1, more: false }, generation: 0,
  onShow() { syncPage(this, "discover"); this.setData({ authenticated: !!session() }); if (session()) void this.load(); },
  onHide() { this.generation++; this.setData({ rows: [], loading: false }); }, onUnload() { this.generation++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "" }); try { const result = await experienceRequest<ExperienceRemoteBooking[]>("bookings?page=" + this.data.page); if (generation !== this.generation) return;
    this.setData({ rows: result.map(r => ({ ...r, title: localText(r.serviceName, currentLocale()), when: date(r.startsAt), label: names[r.status][currentLocale() === "en" ? 1 : 0] })), more: result.length === 30 });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); } finally { if (generation === this.generation) this.setData({ loading: false }); } },
  async action(e: WechatMiniprogram.TouchEvent) { if (this.data.busy) return; const row = this.data.rows.find(r => r.id === e.currentTarget.dataset.id); if (!row) return;
    if (row.pending) { wx.navigateTo({ url: "/pages/provider-booking/index?resume=" + encodeURIComponent(row.id) }); return; }
    const action = e.currentTarget.dataset.action === "cancel" ? (row.status === "waitlisted" ? "leaveWaitlist" : "cancel") : "read", generation = this.generation;
    if (action !== "read") { const confirmed = await wx.showModal({ title: currentLocale() === "en" ? "Cancel this booking?" : "取消这项预约？", content: row.title }); if (!confirmed.confirm || generation !== this.generation) return; }
    this.setData({ busy: true }); try { await experienceRequest("provider", { action, id: requestId(), bookingId: row.id }); if (generation === this.generation) await this.load(); } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); } finally { this.setData({ busy: false }); }
  },
  reschedule(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: "/pages/provider-booking/index?booking=" + encodeURIComponent(String(e.currentTarget.dataset.id)) }); },
  next() { this.setData({ page: this.data.page + 1 }); void this.load(); }, previous() { this.setData({ page: Math.max(1, this.data.page - 1) }); void this.load(); }, login() { loginPage("/pages/provider-bookings/index"); },
});
