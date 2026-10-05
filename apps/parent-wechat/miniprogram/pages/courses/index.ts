import { get, learning, session } from "../../lib/api";
import type { Account, Booking, Participant } from "../../lib/api-types";
import { learnerGradeLabel } from "../../lib/catalog";
import { dateKey, weekDays, weekRange } from "../../lib/discovery";
import { scheduleItems, type ScheduleItem } from "../../lib/schedule";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, errorText, loginPage } from "../../lib/page";

Page({
  data: { ...pageData("courses"), authenticated: false, participants: [] as Participant[], selected: 0,
    selectedDate: dateKey(new Date()), days: [] as ReturnType<typeof weekDays>, weekdays: [] as string[],
    sessions: [] as ScheduleItem[], daySessions: [] as ScheduleItem[], gradeLabel: "", loaded: false, sheet: false },
  loadVersion: 0,
  onShow() {
    syncPage(this, "courses");
    this.setData({ authenticated: Boolean(session()), participants: [], sessions: [], daySessions: [],
      selectedDate: dateKey(new Date()), gradeLabel: "", loaded: false, loading: false, error: "", weekdays: this.data.copy.weekdays.split(",") });
    this.renderWeek();
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; this.setData({ sheet: false }); },
  async load() {
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const account = await get<Account>("account");
      if (version !== this.loadVersion) return;
      const selected = Math.max(0, account.participants.findIndex(row => row.id === selectedParticipant()));
      this.setData({ participants: account.participants, selected });
      if (account.participants.length) await this.loadWeek();
      else this.setData({ loaded: true, loading: false });
    } catch (error) {
      if (version === this.loadVersion) this.setData({ loading: false, error: errorText(error), authenticated: Boolean(session()) });
    }
  },
  async loadWeek() {
    const participant = this.data.participants[this.data.selected];
    if (!participant) return;
    selectParticipant(participant.id);
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "", sessions: [], daySessions: [], gradeLabel: "", loaded: false });
    this.renderWeek();
    try {
      const range = weekRange(this.data.selectedDate);
      const [learningResult, bookingResult] = await Promise.all([
        learning(participant.id, range).then(value => ({ value, error: "" })).catch(error => ({ value: null, error: errorText(error) })),
        get<Booking[]>("bookings").then(value => ({ value, error: "" })).catch(error => ({ value: [] as Booking[], error: errorText(error) })),
      ]);
      if (version !== this.loadVersion) return;
      const info = learningResult.value;
      if (info && info.participantId !== participant.id) throw new Error("Unexpected participant");
      const locale = this.data.locale === "en" ? "en" : "zh";
      const sessions = scheduleItems(info?.schedule || [], bookingResult.value, participant.id, range, locale);
      this.setData({ sessions, gradeLabel: learnerGradeLabel(info?.summary?.grade, locale), loaded: true,
        error: learningResult.error || bookingResult.error }); this.renderWeek();
    } catch (error) {
      if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) });
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
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
  login() { loginPage("/pages/courses/index"); },
});
