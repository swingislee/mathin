import { get, getAssessments, post, session } from "../../lib/api";
import type { Account, AssessmentOverview, Booking, Participant } from "../../lib/api-types";
import { canCancel } from "../../lib/discovery";
import { pageData, syncPage, date, text, errorText, loginPage } from "../../lib/page";
import { assessmentFields, bookedTimeLabel } from "../../lib/assessment-booking";
import { selectParticipant } from "../../lib/navigation";

type AssessmentSource = { participant: Participant; overview: AssessmentOverview };
type BookingView = { key: string; id: string; kind: "activity" | "assessment"; participantId: string; participantName: string;
  label: string; when: string; startsAt: string | null; location: string; details: string; statusText: string;
  phase: "upcoming" | "attended" | "cancelled" | "other"; cancellable: boolean };
Page({
  data: { ...pageData("reservations"), authenticated: false, busy: false, loaded: false,
    bookings: [] as BookingView[], participants: [] as Participant[],
    participantNames: [] as string[], participantIndex: 0, participantId: "", filter: "upcoming", upcomingCount: 0, historyCount: 0 },
  bookingSource: [] as Booking[],
  assessmentSource: [] as AssessmentSource[],
  loadVersion: 0,
  onLoad(query: Record<string, string>) {
    if (["upcoming", "attended", "cancelled", "all"].includes(query.filter)) this.setData({ filter: query.filter });
  },
  onShow() {
    syncPage(this, "reservations");
    this.bookingSource = []; this.assessmentSource = [];
    this.setData({ authenticated: Boolean(session()), bookings: [], participants: [], participantNames: [],
      participantIndex: 0, loaded: false, error: "", loading: false });
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; },
  async load() {
    if (this.data.loading) return;
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const account = await get<Account>("account");
      if (version !== this.loadVersion) return;
      let partial = false;
      const [bookings, assessmentReads] = await Promise.all([
        get<Booking[]>("bookings").catch(() => { partial = true; return [] as Booking[]; }),
        Promise.all(account.participants.map(async participant => {
          try { return { participant, overview: await getAssessments(participant.id) }; }
          catch { partial = true; return null; }
        })),
      ]);
      if (version !== this.loadVersion) return;
      const assessments = assessmentReads.filter((row): row is AssessmentSource => row !== null);
      const participantIndex = account.participants.findIndex(row => row.id === this.data.participantId) + 1;
      this.bookingSource = bookings; this.assessmentSource = assessments;
      this.setData({ participants: account.participants, loaded: true,
        authenticated: Boolean(session()), error: partial ? this.data.copy.bookingsReadIncomplete : "",
        participantNames: [this.data.copy.allParticipants, ...account.participants.map(row => row.name)],
        participantIndex, participantId: participantIndex ? account.participants[participantIndex - 1].id : "" });
      this.applyFilter();
    } catch (error) { if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  applyFilter() {
    const c = this.data.copy;
    const labels = { booked: c.booked, attended: c.attended, no_show: c.noShow, cancelled: c.cancelled };
    const source: BookingView[] = this.bookingSource.map(row => ({ ...row, key: "activity:" + row.id, kind: "activity",
      label: text(row.title), when: date(row.startsAt), details: "", statusText: labels[row.status], cancellable: canCancel(row),
      phase: row.status === "booked" && Date.parse(row.startsAt) > Date.now() ? "upcoming" : row.status === "attended" ? "attended" : row.status === "cancelled" ? "cancelled" : "other" }));
    const assessmentLabels = { coordinating_time: c.assessmentCoordinating, awaiting_facilitator: c.awaitingFacilitator,
      awaiting_participant: c.awaitingParticipant, confirmed: c.assessmentConfirmed, completed: c.assessmentCompleted, cancelled: c.cancelled };
    for (const { participant, overview } of this.assessmentSource) {
      for (const row of overview.requests) {
        if (row.participantId !== participant.id) continue;
        const startsAt = ["confirmed", "completed"].includes(row.state) ? row.confirmedStartsAt : null;
        const fields = row.booking ? assessmentFields(this.data.locale === "en" ? "en" : "zh",
          row.booking.topics, row.booking.stageNumber, overview.topics) : null;
        source.push({ key: "assessment:" + row.id, id: row.id, kind: "assessment", participantId: participant.id,
          participantName: participant.name, label: c.assessmentKind, startsAt,
          when: startsAt ? row.booking ? bookedTimeLabel(startsAt, row.booking.endsAt, c.fullWeekdays.split(",")) : date(startsAt) : c.toBeConfirmed,
          location: row.booking?.mode === "online" ? (this.data.locale === "en" ? "Online" : "线上") : row.booking?.campus.name || "", details: [fields?.topicLabel, fields?.stageLabel,
            row.facilitator ? c.assessmentFacilitator + " · " + row.facilitator.displayName : ""].filter(Boolean).join(" · "),
          statusText: assessmentLabels[row.state], cancellable: false,
          phase: row.state === "cancelled" ? "cancelled" : row.state === "completed" ? "attended"
            : !startsAt || Date.parse(startsAt) > Date.now() ? "upcoming" : "other" });
      }
    }
    const rows = source.filter(row => !this.data.participantId || row.participantId === this.data.participantId);
    const upcoming = rows.filter(row => row.phase === "upcoming");
    const history = rows.filter(row => row.phase !== "upcoming");
    const visible = this.data.filter === "upcoming" ? upcoming : this.data.filter === "all" ? rows
      : rows.filter(row => row.phase === this.data.filter);
    visible.sort((a, b) => {
      if (!a.startsAt) return b.startsAt ? 1 : a.key.localeCompare(b.key);
      if (!b.startsAt) return -1;
      return (Date.parse(a.startsAt) - Date.parse(b.startsAt)) * (this.data.filter === "upcoming" ? 1 : -1);
    });
    this.setData({ upcomingCount: upcoming.length, historyCount: history.length, bookings: visible });
  },
  filter(e: WechatMiniprogram.TouchEvent) {
    const filter = String(e.currentTarget.dataset.value);
    if (["upcoming", "attended", "cancelled", "all"].includes(filter)) { this.setData({ filter }); this.applyFilter(); }
  },
  participant(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({ participantIndex: index, participantId: this.data.participants[index - 1]?.id || "" }); this.applyFilter();
  },
  login() { loginPage("/pages/reservations/index?filter=" + this.data.filter); },
  discover() { wx.switchTab({ url: "/pages/discover/index" }); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=reservations" }); },
  openAssessment(e: WechatMiniprogram.TouchEvent) {
    const row = this.data.bookings.find(item => item.key === e.currentTarget.dataset.key && item.kind === "assessment");
    if (!row) return;
    selectParticipant(row.participantId);
    wx.navigateTo({ url: "/pages/assessment/index?view=history" });
  },
  cancel(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(e.currentTarget.dataset.id);
    if (!this.bookingSource.some(row => row.id === id && canCancel(row))) return;
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
