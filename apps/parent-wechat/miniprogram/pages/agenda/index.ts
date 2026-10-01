import { get, learning, session } from "../../lib/api";
import type { Account, Booking, ParentLearning, Participant } from "../../lib/api-types";
import { calendarDays, dateKey, monthRange, shiftMonth, sessionTimes } from "../../lib/discovery";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, date, text, errorText, loginPage } from "../../lib/page";

type AgendaItem = { key: string; kind: "activity" | "session"; title: string; startsAt: string; when: string; detail: string; teacher: string } & ReturnType<typeof sessionTimes>;
Page({
  data: { ...pageData("agenda"), authenticated: false, participants: [] as Participant[], selected: 0,
    month: dateKey(new Date()).slice(0, 7), selectedDate: dateKey(new Date()),
    weekdays: [] as { key: number; label: string }[], days: [] as ReturnType<typeof calendarDays>,
    learning: null as ParentLearning | null, events: [] as AgendaItem[], dayEvents: [] as AgendaItem[], loaded: false },
  loadVersion: 0,
  onShow() {
    syncPage(this, "agenda");
    this.setData({ authenticated: Boolean(session()), participants: [], learning: null, events: [], dayEvents: [],
      loaded: false, error: "", weekdays: this.data.copy.weekdays.split(",").map((label, key) => ({ label, key })) });
    this.renderCalendar();
    if (session()) void this.loadAccount();
  },
  onHide() { this.loadVersion++; },
  async loadAccount() {
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const account = await get<Account>("account");
      if (version !== this.loadVersion) return;
      const selected = Math.max(0, account.participants.findIndex(row => row.id === selectedParticipant()));
      this.setData({ participants: account.participants, selected });
      if (account.participants.length) await this.loadMonth();
      else this.setData({ loading: false, loaded: true });
    } catch (error) {
      if (version === this.loadVersion) this.setData({ loading: false, error: errorText(error), authenticated: Boolean(session()) });
    }
  },
  async loadMonth() {
    const participant = this.data.participants[this.data.selected];
    if (!participant) return;
    selectParticipant(participant.id);
    const version = ++this.loadVersion;
    const month = this.data.month;
    this.setData({ loading: true, error: "", learning: null, events: [], dayEvents: [], loaded: false });
    this.renderCalendar();
    try {
      // 两类记录独立读取，一项暂不可用时仍显示另一项已确认的安排。
      const results = await Promise.all([
        learning(participant.id, monthRange(month)).then(value => ({ value, error: "" })).catch(error => ({ value: null, error: errorText(error) })),
        get<Booking[]>("bookings").then(value => ({ value, error: "" })).catch(error => ({ value: [] as Booking[], error: errorText(error) })),
      ]);
      if (version !== this.loadVersion) return;
      const learningResult = results[0];
      const bookingResult = results[1];
      const info = learningResult.value;
      if (info && info.participantId !== participant.id) throw new Error("Unexpected participant");
      const sessions: AgendaItem[] = (info?.schedule || []).filter(row => row.participantId === participant.id && dateKey(row.startsAt).startsWith(month))
        .map(row => ({ key: "session-" + row.id, kind: "session", title: row.title, startsAt: row.startsAt,
          when: date(row.startsAt), detail: row.classroomName, teacher: row.teacherName || "", ...sessionTimes(row) }));
      const reservations: AgendaItem[] = bookingResult.value.filter(row => row.participantId === participant.id
        && row.status !== "cancelled" && dateKey(row.startsAt).startsWith(month))
        .map(row => ({ key: "activity-" + row.id, kind: "activity", title: text(row.title), startsAt: row.startsAt,
          when: date(row.startsAt), detail: row.location || this.data.copy.locationPending, teacher: "", ...sessionTimes({ startsAt: row.startsAt, durationMinutes: null }) }));
      const events = [...sessions, ...reservations].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      this.setData({ learning: info, events, loaded: true, error: learningResult.error || bookingResult.error });
      this.renderCalendar();
    } catch (error) { if (version === this.loadVersion) this.setData({ error: errorText(error) }); }
    finally { if (version === this.loadVersion) this.setData({ loading: false, authenticated: Boolean(session()) }); }
  },
  renderCalendar() {
    this.setData({ days: calendarDays(this.data.month, this.data.events.map(row => row.startsAt), this.data.selectedDate),
      dayEvents: this.data.events.filter(row => dateKey(row.startsAt) === this.data.selectedDate) });
  },
  participant(e: WechatMiniprogram.PickerChange) { this.setData({ selected: Number(e.detail.value) }); void this.loadMonth(); },
  changeMonth(e: WechatMiniprogram.TouchEvent) {
    const offset = Number(e.currentTarget.dataset.offset);
    if (offset !== 1 && offset !== -1) return;
    const month = shiftMonth(this.data.month, offset);
    this.setData({ month, selectedDate: month + "-01" }); this.renderCalendar(); void this.loadMonth();
  },
  today() { const selectedDate = dateKey(new Date()); this.setData({ month: selectedDate.slice(0, 7), selectedDate }); this.renderCalendar(); void this.loadMonth(); },
  day(e: WechatMiniprogram.TouchEvent) {
    const value = String(e.currentTarget.dataset.date || "");
    if (value && value.startsWith(this.data.month)) { this.setData({ selectedDate: value }); this.renderCalendar(); }
  },
  retry() { if (this.data.participants.length) void this.loadMonth(); else void this.loadAccount(); },
  login() { loginPage("/pages/agenda/index"); },
});
