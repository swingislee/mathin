import { get, learning, session } from "../../lib/api";
import type { Account, LearningSession, Participant } from "../../lib/api-types";
import { dateKey, weekDays, weekRange, sessionTimes } from "../../lib/discovery";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, errorText, loginPage } from "../../lib/page";

type SessionView = LearningSession & ReturnType<typeof sessionTimes>;
Page({
  data: { ...pageData("courses"), authenticated: false, participants: [] as Participant[], selected: 0,
    selectedDate: dateKey(new Date()), days: [] as ReturnType<typeof weekDays>, weekdays: [] as string[],
    sessions: [] as SessionView[], daySessions: [] as SessionView[], loaded: false, sheet: false },
  loadVersion: 0,
  onShow() {
    syncPage(this, "courses");
    this.setData({ authenticated: Boolean(session()), participants: [], sessions: [], daySessions: [],
      selectedDate: dateKey(new Date()), loaded: false, loading: false, error: "", weekdays: this.data.copy.weekdays.split(",") });
    this.renderWeek();
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; },
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
    this.setData({ loading: true, error: "", sessions: [], daySessions: [], loaded: false });
    this.renderWeek();
    try {
      const range = weekRange(this.data.selectedDate);
      const info = await learning(participant.id, range);
      if (version !== this.loadVersion) return;
      if (info.participantId !== participant.id) throw new Error("Unexpected participant");
      const sessions = info.schedule.filter(row => row.participantId === participant.id
        && Date.parse(row.startsAt) >= Date.parse(range.from) && Date.parse(row.startsAt) < Date.parse(range.to))
        .map(row => ({ ...row, ...sessionTimes(row) })).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      this.setData({ sessions, loaded: true }); this.renderWeek();
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
