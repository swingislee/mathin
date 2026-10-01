import { get, post, session, ApiError } from "../../lib/api";
import type { Account, Activity, Booking, Participant } from "../../lib/api-types";
import { canReserve } from "../../lib/discovery";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, text, date, errorText, loginPage } from "../../lib/page";

type ActivityView = Activity & { label: string; body: string; when: string };
Page({
  data: { ...pageData("discover"), id: "", activity: null as ActivityView | null,
    participants: [] as Participant[], bookings: [] as Booking[], selected: 0,
    authenticated: false, busy: false, booked: false, step: 1, uncertain: false, loaded: false },
  loadVersion: 0,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() {
    syncPage(this, "discover", "activityDetail");
    // 微信授权、系统弹层返回时，保留正在提交的参与人快照。
    if (this.data.busy) return;
    this.setData({ authenticated: Boolean(session()), participants: [], bookings: [], booked: false, step: 1, loaded: false, loading: false });
    void this.load();
  },
  onHide() { this.loadVersion++; },
  async load() {
    if (this.data.loading || this.data.busy) return;
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const rows = await get<Activity[]>("activities", "", false);
      if (version !== this.loadVersion) return;
      const item = rows.find(row => row.id === this.data.id);
      if (!item) { this.setData({ activity: null, error: this.data.copy.notFound }); return; }
      this.setData({ activity: { ...item, label: text(item.title), body: text(item.description), when: date(item.startsAt) } });
      if (session()) {
        const [account, bookings] = await Promise.all([get<Account>("account"), get<Booking[]>("bookings")]);
        if (version !== this.loadVersion) return;
        const selected = Math.max(0, account.participants.findIndex(row => row.id === selectedParticipant()));
        this.setData({ participants: account.participants, bookings, selected });
        this.updateSelection();
      }
      this.setData({ loaded: true, uncertain: false });
    } catch (error) { if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  updateSelection() {
    const participant = this.data.participants[this.data.selected];
    this.setData({ booked: Boolean(participant && this.data.bookings.some(row => row.activityId === this.data.id
      && row.participantId === participant.id && row.status !== "cancelled")), step: 1 });
    if (participant) selectParticipant(participant.id);
  },
  change(e: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.uncertain) return;
    this.setData({ selected: Number(e.detail.value) }); this.updateSelection();
  },
  review() {
    if (this.data.loaded && !this.data.busy && !this.data.uncertain && this.data.activity && canReserve(this.data.activity)
      && this.data.participants[this.data.selected] && !this.data.booked) this.setData({ step: 2, error: "" });
  },
  back() { if (!this.data.busy && !this.data.uncertain) this.setData({ step: 1 }); },
  login() { loginPage("/pages/activity/index?id=" + encodeURIComponent(this.data.id)); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=activity-" + encodeURIComponent(this.data.id) }); },
  reservations() { wx.switchTab({ url: "/pages/reservations/index" }); },
  async book() {
    const participant = this.data.participants[this.data.selected];
    if (this.data.busy || this.data.booked || this.data.uncertain || !participant || this.data.step !== 2
      || !this.data.activity || !canReserve(this.data.activity)) return;
    this.setData({ busy: true, error: "" });
    try {
      await post({ action: "book", activityId: this.data.id, participantId: participant.id });
      this.setData({ booked: true });
      wx.showToast({ title: this.data.copy.confirmed, icon: "success" });
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE"].includes(error.code);
      this.setData({ uncertain, error: uncertain ? this.data.copy.checkReservation : errorText(error) });
    } finally { this.setData({ busy: false }); }
  },
});
