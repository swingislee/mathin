import { get, participantCalendar, session } from "../../lib/api";
import type { Account, Booking, Participant } from "../../lib/api-types";
import { participantStageLabel } from "../../lib/catalog";
import { dateKey, weekDays, weekRange } from "../../lib/discovery";
import { calendarItems, type CalendarItem } from "../../lib/calendar";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, errorText, loginPage } from "../../lib/page";

Page({
  data: { ...pageData("calendar"), authenticated: false, participants: [] as Participant[], selected: 0,
    selectedDate: dateKey(new Date()), days: [] as ReturnType<typeof weekDays>, weekdays: [] as string[],
    sessions: [] as CalendarItem[], daySessions: [] as CalendarItem[], stageLabel: "", loaded: false, sheet: false },
  loadVersion: 0,
  sessionToken: "",
  calendarKey: "",
  onShow() {
    syncPage(this, "calendar");
    const current = session(), token = current?.accessToken || "";
    const reset = !current || token !== this.sessionToken;
    this.sessionToken = token;
    this.setData({ authenticated: Boolean(current), loading: false, error: "", weekdays: this.data.copy.weekdays.split(","),
      ...(reset ? { participants: [], selected: 0, sessions: [], daySessions: [], selectedDate: dateKey(new Date()), stageLabel: "", loaded: false } : {}) });
    if (reset) this.calendarKey = "";
    const selected = this.data.participants.findIndex(row => row.id === selectedParticipant());
    if (selected >= 0 && selected !== this.data.selected) {
      this.calendarKey = "";
      this.setData({ selected, sessions: [], daySessions: [], stageLabel: "", loaded: false });
    }
    this.renderWeek();
    if (current) void this.load();
  },
  onHide() { this.loadVersion++; this.setData({ sheet: false }); },
  async load() {
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const account = await get<Account>("account");
      if (version !== this.loadVersion) return;
      this.sessionToken = session()?.accessToken || "";
      const selected = Math.max(0, account.participants.findIndex(row => row.id === selectedParticipant()));
      this.setData({ participants: account.participants, selected });
      if (account.participants.length) await this.loadWeek();
      else {
        this.calendarKey = "";
        this.setData({ sessions: [], daySessions: [], stageLabel: "", loaded: true, loading: false });
        this.renderWeek();
      }
    } catch (error) {
      if (version === this.loadVersion) {
        this.setData({ loading: false });
        this.loadError(errorText(error));
      }
    }
  },
  async loadWeek() {
    const participant = this.data.participants[this.data.selected];
    if (!participant) return;
    selectParticipant(participant.id);
    const version = ++this.loadVersion;
    const range = weekRange(this.data.selectedDate);
    const key = `${participant.id}:${range.from}:${this.data.locale}`;
    const reset = key !== this.calendarKey;
    this.calendarKey = key;
    this.setData({ loading: true, error: "", ...(reset ? { sessions: [], daySessions: [], stageLabel: "", loaded: false } : {}) });
    this.renderWeek();
    try {
      const [calendarResult, bookingResult] = await Promise.all([
        participantCalendar(participant.id, range).then(value => ({ value, error: "" })).catch(error => ({ value: null, error: errorText(error) })),
        get<Booking[]>("bookings").then(value => ({ value, error: "" })).catch(error => ({ value: [] as Booking[], error: errorText(error) })),
      ]);
      if (version !== this.loadVersion) return;
      if (calendarResult.error && bookingResult.error) {
        this.loadError(calendarResult.error);
        return;
      }
      this.sessionToken = session()?.accessToken || "";
      const info = calendarResult.value;
      if (info && info.participantId !== participant.id) throw new Error("Unexpected participant");
      const locale = this.data.locale === "en" ? "en" : "zh";
      const sessions = calendarItems(info?.calendar || [], bookingResult.value, participant.id, range, locale);
      this.setData({ sessions, stageLabel: participantStageLabel(info?.summary?.stageNumber, locale), loaded: true,
        error: calendarResult.error || bookingResult.error }); this.renderWeek();
    } catch (error) {
      if (version === this.loadVersion) this.loadError(errorText(error));
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  loadError(message: string) {
    const current = session();
    const reset = !current || current.accessToken !== this.sessionToken;
    if (reset) this.calendarKey = "";
    this.setData({ error: message, authenticated: Boolean(current),
      ...(reset ? { participants: [], sessions: [], daySessions: [], stageLabel: "", loaded: false } : {}) });
    this.renderWeek();
  },
  renderWeek() {
    this.setData({ days: weekDays(this.data.selectedDate, this.data.sessions.map(row => row.startsAt)),
      daySessions: this.data.sessions.filter(row => dateKey(row.startsAt) === this.data.selectedDate) });
  },
  showParticipants() { if (!session()) this.login(); else this.setData({ sheet: true }); },
  closeSheet() { this.setData({ sheet: false }); },
  noop() {},
  participant(e: WechatMiniprogram.TouchEvent) {
    const selected = Number(e.currentTarget.dataset.index);
    if (!this.data.participants[selected]) return;
    this.setData({ selected, sheet: false }); void this.loadWeek();
  },
  day(e: WechatMiniprogram.TouchEvent) {
    const selectedDate = String(e.currentTarget.dataset.date);
    if (this.data.days.some(row => row.date === selectedDate)) { this.setData({ selectedDate }); this.renderWeek(); }
  },
  agenda() { wx.navigateTo({ url: "/pages/agenda/index" }); },
  login() { loginPage("/pages/calendar/index"); },
});
