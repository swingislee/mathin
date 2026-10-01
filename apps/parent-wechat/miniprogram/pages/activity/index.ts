import { get, post, session, ApiError } from "../../lib/api";
import type { Account, Activity, Booking, Participant } from "../../lib/api-types";
import { canReserve, dateKey, weekRange, sessionTimes } from "../../lib/discovery";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, text, date, errorText, loginPage } from "../../lib/page";

type ActivityView = Activity & { label: string; body: string; when: string };
type Slot = { id: string; available: boolean; reserved: boolean; selected: boolean };
type SlotRow = { key: string; start: string; end: string; cells: { date: string; options: Slot[] }[] };
function sameActivity(a: Activity, b: Activity) {
  return a.title.zh === b.title.zh && a.title.en === b.title.en
    && a.description.zh === b.description.zh && a.description.en === b.description.en;
}
Page({
  data: { ...pageData("discover"), id: "", activity: null as ActivityView | null, source: [] as Activity[],
    choices: [] as { id: string; label: string }[], participants: [] as Participant[], bookings: [] as Booking[], selected: 0,
    authenticated: false, busy: false, booked: false, reservationConfirmed: false, hasAvailableSlots: false,
    step: 1, uncertain: false, loaded: false, sheet: "",
    location: "", locations: [] as string[], slotWeek: "", slotWeekLabel: "", selectedSlot: "",
    slotDays: [] as { date: string; label: string; weekday: string }[], slotRows: [] as SlotRow[] },
  loadVersion: 0,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() {
    syncPage(this, "discover", "activityBooking");
    if (this.data.busy) return;
    this.setData({ authenticated: Boolean(session()), participants: [], bookings: [], booked: false,
      step: 1, loaded: false, loading: false, selectedSlot: "", sheet: "", reservationConfirmed: false });
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
      const groups: Activity[] = [];
      rows.forEach(row => {
        const index = groups.findIndex(group => sameActivity(group, row));
        if (index < 0) groups.push(row);
        else if (!canReserve(groups[index]) && canReserve(row)) groups[index] = row;
      });
      this.setData({ source: rows, choices: groups.map(row => ({ id: row.id, label: text(row.title) })) });
      const item = this.data.id ? rows.find(row => row.id === this.data.id) : rows.find(canReserve) || rows[0];
      if (!item) {
        this.setData({ activity: null, loaded: true, error: this.data.id ? this.data.copy.notFound : "" });
        return;
      }
      this.selectActivity(item);
      if (session()) {
        const [account, bookings] = await Promise.all([get<Account>("account"), get<Booking[]>("bookings")]);
        if (version !== this.loadVersion) return;
        const selected = Math.max(0, account.participants.findIndex(row => row.id === selectedParticipant()));
        this.setData({ participants: account.participants, bookings, selected });
        this.updateSelection();
      }
      this.setData({ loaded: true, uncertain: false }); this.renderSlots();
    } catch (error) { if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  selectActivity(item: Activity) {
    const locations = Array.from(new Set(this.data.source.filter(row => sameActivity(row, item)).map(row => row.location)));
    this.setData({ id: item.id, activity: { ...item, label: text(item.title), body: text(item.description), when: date(item.startsAt) },
      location: item.location, locations, slotWeek: dateKey(new Date(weekRange(new Date(item.startsAt)).from)), selectedSlot: "", sheet: "", step: 1 });
    this.updateSelection(); this.renderSlots();
  },
  updateSelection() {
    const participant = this.data.participants[this.data.selected];
    this.setData({ booked: Boolean(participant && this.data.bookings.some(row => row.activityId === this.data.id
      && row.participantId === participant.id && row.status !== "cancelled")), step: 1, selectedSlot: "", reservationConfirmed: false });
    if (participant) selectParticipant(participant.id);
    this.refreshAvailability();
  },
  refreshAvailability() {
    const activity = this.data.activity;
    const participant = this.data.participants[this.data.selected];
    const rows = this.data.source.length ? this.data.source : activity ? [activity] : [];
    this.setData({ hasAvailableSlots: Boolean(activity && rows.some(row => sameActivity(row, activity) && canReserve(row)
      && !this.data.bookings.some(booking => booking.activityId === row.id && booking.participantId === participant?.id && booking.status !== "cancelled"))) });
  },
  showSheet(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.busy && !this.data.loading && !this.data.uncertain) this.setData({ sheet: String(e.currentTarget.dataset.sheet) });
  },
  closeSheet() { this.setData({ sheet: "" }); },
  noop() {},
  chooseParticipant(e: WechatMiniprogram.TouchEvent) {
    const selected = Number(e.currentTarget.dataset.index);
    if (this.data.busy || this.data.uncertain || !this.data.participants[selected]) return;
    this.setData({ selected, sheet: "" }); this.updateSelection(); this.renderSlots();
  },
  change(e: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.uncertain) return;
    this.setData({ selected: Number(e.detail.value) }); this.updateSelection(); this.renderSlots();
  },
  chooseActivity(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || this.data.uncertain) return;
    const item = this.data.source.find(row => row.id === String(e.currentTarget.dataset.id));
    if (item) this.selectActivity(item);
  },
  review() {
    this.refreshAvailability();
    if (this.data.loaded && !this.data.busy && !this.data.uncertain && this.data.activity && this.data.hasAvailableSlots
      && this.data.participants[this.data.selected]) {
      this.setData({ step: 2, error: "" }); this.renderSlots();
    }
  },
  back() { if (!this.data.busy && !this.data.uncertain) this.setData({ step: 1 }); },
  startAgain() { if (!this.data.busy) this.updateSelection(); },
  location(e: WechatMiniprogram.TouchEvent) {
    const location = String(e.currentTarget.dataset.value || "");
    if (this.data.busy || this.data.uncertain || !this.data.locations.includes(location)) return;
    this.setData({ location, selectedSlot: "" }); this.renderSlots();
  },
  moveWeek(e: WechatMiniprogram.TouchEvent) {
    const offset = Number(e.currentTarget.dataset.offset);
    if (this.data.busy || this.data.uncertain || ![-1, 1].includes(offset)) return;
    const first = new Date(this.data.slotWeek + "T12:00:00");
    first.setDate(first.getDate() + offset * 7);
    this.setData({ slotWeek: dateKey(first), selectedSlot: "" }); this.renderSlots();
  },
  renderSlots() {
    const anchor = this.data.activity;
    if (!anchor || !this.data.slotWeek) return;
    const first = new Date(this.data.slotWeek + "T12:00:00");
    const weekdays = this.data.copy.weekdays.split(",");
    const slotDays = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
      return { date: dateKey(day), label: String(day.getMonth() + 1) + "." + day.getDate(), weekday: weekdays[index] };
    });
    const rows = this.data.source.filter(row => sameActivity(row, anchor) && row.location === this.data.location
      && slotDays.some(day => day.date === dateKey(row.startsAt)));
    const times = Array.from(new Set(rows.map(row => {
      const time = sessionTimes(row); return time.startTime + "|" + time.endTime;
    }))).sort();
    const member = this.data.participants[this.data.selected];
    const slotRows = times.map(key => {
      const [start, end] = key.split("|");
      return { key, start, end, cells: slotDays.map(day => ({
        date: day.date, options: rows.filter(row => {
          const time = sessionTimes(row);
          return dateKey(row.startsAt) === day.date && time.startTime + "|" + time.endTime === key;
        }).map(row => {
          const reserved = this.data.bookings.some(booking => booking.activityId === row.id
            && booking.participantId === member?.id && booking.status !== "cancelled");
          return { id: row.id, available: canReserve(row) && !reserved, reserved, selected: row.id === this.data.selectedSlot };
        }),
      })) };
    });
    this.setData({ slotDays, slotRows, slotWeekLabel: slotDays[0].label + " ~ " + slotDays[6].label });
  },
  chooseSlot(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || this.data.uncertain) return;
    const id = String(e.currentTarget.dataset.id);
    const visible = this.data.slotRows.some(row => row.cells.some(cell => cell.options.some(option => option.id === id && option.available)));
    const item = this.data.source.find(row => row.id === id);
    if (!visible || !item) return;
    this.setData({ id, activity: { ...item, label: text(item.title), body: text(item.description), when: date(item.startsAt) }, selectedSlot: id, booked: false });
    this.renderSlots();
  },
  resetSlots() {
    if (this.data.busy || this.data.uncertain) return;
    this.setData({ selectedSlot: "" }); this.renderSlots();
  },
  login() { loginPage("/pages/activity/index" + (this.data.id ? "?id=" + encodeURIComponent(this.data.id) : "")); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=activity" }); },
  reservations() { wx.navigateTo({ url: "/pages/reservations/index" }); },
  async book() {
    const participant = this.data.participants[this.data.selected];
    const activity = this.data.activity;
    if (this.data.busy || this.data.booked || this.data.uncertain || !participant || this.data.step !== 2
      || this.data.selectedSlot !== this.data.id || !activity || !canReserve(activity)) return;
    this.setData({ busy: true, error: "" });
    try {
      const result = await post<{ id: string }>({ action: "book", activityId: this.data.id, participantId: participant.id });
      const confirmed: Booking = { id: result.id, activityId: activity.id, participantId: participant.id,
        participantName: participant.name, title: activity.title, startsAt: activity.startsAt, location: activity.location, status: "booked" };
      this.setData({ booked: true, reservationConfirmed: true, bookings: [...this.data.bookings.filter(row => row.id !== result.id), confirmed] });
      wx.showToast({ title: this.data.copy.confirmed, icon: "success" });
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE"].includes(error.code);
      this.setData({ uncertain, error: uncertain ? this.data.copy.checkReservation : errorText(error) });
    } finally { this.setData({ busy: false }); }
  },
});
