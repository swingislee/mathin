import { get, post, session } from "../../lib/api";
import type { Account, Booking, Participant } from "../../lib/api-types";
import { canCancel } from "../../lib/discovery";
import { pageData, syncPage, date, text, errorText, loginPage } from "../../lib/page";

type BookingView = Booking & { label: string; when: string; statusText: string; cancellable: boolean };
Page({
  data: { ...pageData("reservations"), authenticated: false, busy: false, loaded: false,
    source: [] as Booking[], bookings: [] as BookingView[], participants: [] as Participant[],
    participantNames: [] as string[], participantIndex: 0, participantId: "", filter: "upcoming", upcomingCount: 0, historyCount: 0 },
  loadVersion: 0,
  onShow() {
    syncPage(this, "reservations");
    this.setData({ authenticated: Boolean(session()), source: [], bookings: [], participants: [], participantNames: [],
      participantIndex: 0, loaded: false, error: "", loading: false });
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; },
  async load() {
    if (this.data.loading) return;
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const [account, bookings] = await Promise.all([get<Account>("account"), get<Booking[]>("bookings")]);
      if (version !== this.loadVersion) return;
      const participantIndex = account.participants.findIndex(row => row.id === this.data.participantId) + 1;
      this.setData({ source: bookings, participants: account.participants, loaded: true,
        participantNames: [this.data.copy.allParticipants, ...account.participants.map(row => row.name)],
        participantIndex, participantId: participantIndex ? account.participants[participantIndex - 1].id : "" });
      this.applyFilter();
    } catch (error) { if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  applyFilter() {
    const c = this.data.copy;
    const labels = { booked: c.booked, attended: c.attended, no_show: c.noShow, cancelled: c.cancelled };
    const rows = this.data.source.filter(row => !this.data.participantId || row.participantId === this.data.participantId);
    const upcoming = rows.filter(row => canCancel(row));
    const history = rows.filter(row => !canCancel(row));
    const visible = this.data.filter === "upcoming" ? upcoming : history;
    visible.sort((a, b) => (Date.parse(a.startsAt) - Date.parse(b.startsAt)) * (this.data.filter === "upcoming" ? 1 : -1));
    this.setData({ upcomingCount: upcoming.length, historyCount: history.length,
      bookings: visible.map(row => ({ ...row, label: text(row.title), when: date(row.startsAt), statusText: labels[row.status], cancellable: canCancel(row) })) });
  },
  filter(e: WechatMiniprogram.TouchEvent) { this.setData({ filter: e.currentTarget.dataset.value === "history" ? "history" : "upcoming" }); this.applyFilter(); },
  participant(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({ participantIndex: index, participantId: this.data.participants[index - 1]?.id || "" }); this.applyFilter();
  },
  login() { loginPage("/pages/reservations/index"); },
  discover() { wx.switchTab({ url: "/pages/discover/index" }); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=reservations" }); },
  cancel(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(e.currentTarget.dataset.id);
    if (!this.data.source.some(row => row.id === id && canCancel(row))) return;
    wx.showModal({ title: this.data.copy.cancelBooking, content: this.data.copy.cancelConfirm,
      confirmText: this.data.copy.confirmCancel, cancelText: this.data.copy.keep,
      success: result => { if (result.confirm) void this.doCancel(id); } });
  },
  async doCancel(id: string) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try { await post({ action: "cancel", id }); await this.load(); wx.showToast({ title: this.data.copy.cancellationDone, icon: "success" }); }
    catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ busy: false }); }
  },
});
