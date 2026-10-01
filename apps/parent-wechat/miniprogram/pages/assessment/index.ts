import { get, getAssessments, postAssessment, requestId, session, ApiError } from "../../lib/api";
import type { Account, Participant, ParentAssessmentOverview, ParentAssessmentRequest, AssessmentState } from "../../lib/api-types";
import { pageData, syncPage, errorText, loginPage } from "../../lib/page";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { assessmentDay, assessmentWeek, assessmentGrid, assessmentTimeLabel, futureAssessmentOption, shiftDay } from "../../lib/assessment-calendar";
import { pendingAssessment, savePendingAssessment, clearPendingAssessment, type PendingAssessmentRequest } from "../../lib/assessment-pending";

const timeKeys = ["09:50", "10:00", "14:00", "16:00", "17:00", "17:30", "19:20", "after_school"];
type RequestView = ParentAssessmentRequest & { teacherName: string; statusLabel: string; scheduledLabel: string;
  preferredLabel: string; confirmOptions: { value: string; label: string }[] };
const unknownResult = (error: unknown) => !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "CONFLICT", "UNAUTHENTICATED"].includes(error.code);

Page({
  data: { ...pageData("discover"), authenticated: false, loaded: false, accountId: "", participants: [] as Participant[], selected: 0,
    overview: null as ParentAssessmentOverview | null, teachers: [] as { id: string; name: string }[], teacherId: "", teacherName: "",
    requests: [] as RequestView[], eligible: false, eligibilityHint: "", sheet: "", showHistory: false, step: 1,
    busy: false, busyId: "", uncertain: false, confirmUncertain: false, pending: null as PendingAssessmentRequest | null, pendingChecked: false, requestSent: false, requestSentStatus: "",
    firstDay: "", lastDay: "", week: "", weekLabel: "", days: [] as ReturnType<typeof assessmentGrid>["days"],
    timeRows: [] as ReturnType<typeof assessmentGrid>["timeRows"], selectedTimes: [] as string[], selectedLabels: [] as string[],
    canPrevious: false, canNext: false, confirmationId: "", confirmationTime: "" },
  loadVersion: 0,
  onLoad(query: Record<string, string>) { this.setData({ showHistory: query.view === "history" }); },
  onShow() {
    syncPage(this, "discover", "assessmentBooking");
    if (this.data.busy) return;
    const firstDay = assessmentDay();
    this.setData({ authenticated: Boolean(session()), loaded: false, loading: false, accountId: "", participants: [],
      overview: null, teachers: [], requests: [], teacherId: "", teacherName: "", eligible: false, eligibilityHint: "", error: "",
      step: 1, sheet: "", uncertain: false, confirmUncertain: false, pending: null, pendingChecked: false, requestSent: false, selectedTimes: [], selectedLabels: [],
      firstDay, lastDay: shiftDay(firstDay, 27), week: assessmentWeek(firstDay), confirmationId: "", confirmationTime: "" });
    this.renderTimes();
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; this.setData({ sheet: "" }); },
  async load() {
    if (this.data.busy || !session()) return;
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const account = await get<Account>("account");
      if (version !== this.loadVersion) return;
      const selected = Math.max(0, account.participants.findIndex(row => row.id === selectedParticipant()));
      this.setData({ accountId: account.id, participants: account.participants, selected });
      if (account.participants.length) await this.loadParticipant();
      else this.setData({ loading: false, loaded: true, eligible: false, eligibilityHint: this.data.copy.noLinkNote });
    } catch (error) {
      if (version === this.loadVersion) this.setData({ loading: false, error: errorText(error), authenticated: Boolean(session()) });
    }
  },
  async loadParticipant() {
    const participant = this.data.participants[this.data.selected];
    if (!participant || this.data.busy) return;
    selectParticipant(participant.id);
    const version = ++this.loadVersion;
    const pending = pendingAssessment(this.data.accountId, participant.id);
    this.setData({ loading: true, loaded: false, error: "", overview: null, requests: [], teachers: [], eligible: false,
      eligibilityHint: "", teacherId: "", teacherName: "", selectedTimes: [], selectedLabels: [], step: 1, requestSent: false,
      confirmationId: "", confirmationTime: "", pending, pendingChecked: false, uncertain: Boolean(pending) });
    try {
      const overview = await getAssessments(participant.id);
      if (version !== this.loadVersion) return;
      if (overview.participantId !== participant.id || overview.timeZone !== "Asia/Shanghai") throw new Error("Unexpected assessment participant");
      const recovered = pending && overview.requests.some(row => row.id === pending.id && row.participantId === participant.id);
      if (recovered) clearPendingAssessment(this.data.accountId, participant.id);
      const eligibility = overview.eligibility;
      const eligibilityHint = eligibility.canRequest ? "" : eligibility.reason === "ACTIVE_INVITATION" ? this.data.copy.assessmentActive
        : eligibility.reason === "NO_ELIGIBLE_TEACHER" ? this.data.copy.noAssessors : this.data.copy.assessmentProfileNeeded;
      this.setData({ overview, teachers: overview.teachers.map(row => ({ id: row.id, name: row.displayName })),
        eligible: eligibility.canRequest, eligibilityHint, loaded: true, pending: recovered ? null : pending, pendingChecked: Boolean(pending && !recovered), uncertain: Boolean(pending && !recovered), confirmUncertain: false,
        error: pending && !recovered ? this.data.copy.checkAssessment : "",
        showHistory: this.data.showHistory || Boolean(recovered) || eligibility.reason === "ACTIVE_INVITATION" });
      this.renderRequests(); this.renderTimes();
    } catch (error) {
      if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) });
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  stateLabel(state: AssessmentState) {
    const copy = this.data.copy;
    return ({ coordinating_time: copy.assessmentCoordinating, awaiting_teacher: copy.awaitingTeacher,
      awaiting_parent: copy.awaitingParent, confirmed: copy.assessmentConfirmed, completed: copy.assessmentCompleted, cancelled: copy.cancelled })[state];
  },
  renderRequests() {
    const participant = this.data.participants[this.data.selected];
    const requests = (this.data.overview?.requests || []).filter(row => row.participantId === participant?.id).map(row => {
      const confirmOptions = row.canConfirm && row.state === "awaiting_parent" ? row.sharedTimeOptions
        .filter(option => !option.endsWith("@after_school") && futureAssessmentOption(option)
          && row.parentTimeOptions.includes(option) && row.teacherTimeOptions.includes(option))
        .map(value => ({ value, label: assessmentTimeLabel(value, this.data.copy.afterSchool) })) : [];
      const scheduledToken = row.scheduledAt ? new Date(Date.parse(row.scheduledAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", "@") : "";
      return { ...row, teacherName: row.teacher?.displayName || this.data.copy.toBeConfirmed, statusLabel: this.stateLabel(row.state),
        scheduledLabel: ["confirmed", "completed"].includes(row.state) && scheduledToken ? assessmentTimeLabel(scheduledToken, this.data.copy.afterSchool) : "",
        preferredLabel: row.parentTimeOptions.map(option => assessmentTimeLabel(option, this.data.copy.afterSchool)).join("、"), confirmOptions };
    });
    this.setData({ requests });
  },
  renderTimes() {
    if (!this.data.firstDay || !this.data.week) return;
    this.setData({ ...assessmentGrid({ week: this.data.week, firstDay: this.data.firstDay, lastDay: this.data.lastDay,
      weekdays: this.data.copy.weekdays.split(","), selected: this.data.selectedTimes,
      definitions: timeKeys.map(key => ({ key, label: key === "after_school" ? this.data.copy.afterSchool : key })) }),
      selectedLabels: this.data.selectedTimes.map(value => assessmentTimeLabel(value, this.data.copy.afterSchool)) });
  },
  showSheet(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.busy && !this.data.loading) this.setData({ sheet: String(e.currentTarget.dataset.sheet) });
  },
  closeSheet() { this.setData({ sheet: "" }); },
  noop() {},
  chooseParticipant(e: WechatMiniprogram.TouchEvent) {
    const selected = Number(e.currentTarget.dataset.index);
    if (this.data.busy || !this.data.participants[selected]) return;
    this.setData({ selected, sheet: "" }); void this.loadParticipant();
  },
  chooseTeacher(e: WechatMiniprogram.TouchEvent) {
    const teacher = this.data.teachers.find(row => row.id === String(e.currentTarget.dataset.id));
    if (this.data.busy || this.data.uncertain || !teacher) return;
    this.setData({ teacherId: teacher.id, teacherName: teacher.name, sheet: "" });
  },
  review() {
    if (this.data.loaded && this.data.eligible && this.data.teacherId && !this.data.busy && !this.data.uncertain) {
      this.setData({ step: 2, error: "" }); this.renderTimes();
    }
  },
  back() { if (!this.data.busy && !this.data.uncertain) this.setData({ step: 1 }); },
  moveWeek(e: WechatMiniprogram.TouchEvent) {
    const offset = Number(e.currentTarget.dataset.offset);
    if (this.data.busy || this.data.uncertain || ![-1, 1].includes(offset)
      || (offset < 0 && !this.data.canPrevious) || (offset > 0 && !this.data.canNext)) return;
    this.setData({ week: shiftDay(this.data.week, offset * 7) }); this.renderTimes();
  },
  chooseTime(e: WechatMiniprogram.TouchEvent) {
    const value = String(e.currentTarget.dataset.value);
    if (this.data.busy || this.data.uncertain || !this.data.timeRows.some(row => row.cells.some(cell => cell.value === value && (cell.selectable || cell.selected)))) return;
    const selectedTimes = this.data.selectedTimes.includes(value) ? this.data.selectedTimes.filter(item => item !== value)
      : this.data.selectedTimes.length < 84 ? [...this.data.selectedTimes, value].sort() : this.data.selectedTimes;
    this.setData({ selectedTimes }); this.renderTimes();
  },
  resetTimes() { if (!this.data.busy && !this.data.uncertain) { this.setData({ selectedTimes: [] }); this.renderTimes(); } },
  toggleHistory() { if (!this.data.busy) this.setData({ showHistory: !this.data.showHistory, sheet: "", requestSent: false }); },
  viewHistory() { if (!this.data.busy) { this.setData({ showHistory: true }); void this.load(); } },
  async submit() {
    if (this.data.busy || this.data.uncertain || !this.data.loaded || !this.data.eligible || this.data.step !== 2
      || !this.data.teachers.some(row => row.id === this.data.teacherId) || !this.data.selectedTimes.length) return;
    if (this.data.selectedTimes.some(value => !futureAssessmentOption(value))) { this.setData({ error: this.data.copy.conflict }); this.renderTimes(); return; }
    await this.sendRequest({ id: requestId(), teacherId: this.data.teacherId, parentTimeOptions: [...this.data.selectedTimes] });
  },
  async retryPending() { if (this.data.pending && !this.data.busy) await this.sendRequest(this.data.pending); },
  startOver() {
    const participant = this.data.participants[this.data.selected];
    const { overview, pending } = this.data;
    if (this.data.busy || !participant || !pending || !this.data.pendingChecked || !overview?.eligibility.canRequest
      || overview.requests.some(row => row.id === pending.id)) return;
    clearPendingAssessment(this.data.accountId, participant.id);
    this.setData({ pending: null, pendingChecked: false, uncertain: false, error: "", showHistory: false,
      teacherId: "", teacherName: "", selectedTimes: [], selectedLabels: [], step: 1 });
    this.renderTimes();
  },
  async sendRequest(pending: PendingAssessmentRequest) {
    const participant = this.data.participants[this.data.selected];
    if (this.data.busy || !participant || !this.data.accountId) return;
    const accountId = this.data.accountId;
    this.setData({ busy: true, busyId: pending.id, error: "", pendingChecked: false });
    try {
      savePendingAssessment(accountId, participant.id, pending);
      this.setData({ pending });
      const request = await postAssessment({ action: "request", ...pending, participantId: participant.id });
      if (request.id !== pending.id || request.participantId !== participant.id) throw new Error("Unexpected assessment receipt");
      clearPendingAssessment(accountId, participant.id);
      const overview = this.data.overview;
      this.setData({ pending: null, uncertain: false, requestSent: true, requestSentStatus: this.stateLabel(request.state), showHistory: false,
        eligible: false, overview: overview ? { ...overview, requests: [request, ...overview.requests.filter(row => row.id !== request.id)] } : null });
      this.renderRequests();
    } catch (error) {
      const uncertain = unknownResult(error);
      if (!uncertain) { clearPendingAssessment(accountId, participant.id); this.setData({ pending: null }); }
      this.setData({ uncertain, authenticated: Boolean(session()), error: uncertain ? this.data.copy.checkAssessment : errorText(error) });
    } finally { this.setData({ busy: false, busyId: "" }); }
  },
  selectConfirmation(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id), value = String(e.currentTarget.dataset.value);
    const request = this.data.requests.find(row => row.id === id);
    if (!this.data.busy && !this.data.confirmUncertain && request?.confirmOptions.some(option => option.value === value)) {
      this.setData({ confirmationId: id, confirmationTime: value });
    }
  },
  async confirm(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    const request = this.data.requests.find(row => row.id === id);
    const participant = this.data.participants[this.data.selected];
    if (this.data.busy || this.data.confirmUncertain || !participant || !request || request.participantId !== participant.id
      || this.data.confirmationId !== id || !request.canConfirm || request.state !== "awaiting_parent"
      || !request.confirmOptions.some(option => option.value === this.data.confirmationTime && futureAssessmentOption(option.value))) return;
    this.setData({ busy: true, busyId: id, error: "" });
    try {
      const result = await postAssessment({ action: "confirm", id, participantId: participant.id,
        timeOption: this.data.confirmationTime, expectedUpdatedAt: request.updatedAt });
      if (result.id !== id || result.participantId !== participant.id) throw new Error("Unexpected assessment receipt");
      const overview = this.data.overview;
      this.setData({ overview: overview ? { ...overview, requests: overview.requests.map(row => row.id === id ? result : row) } : null,
        confirmationId: "", confirmationTime: "" });
      this.renderRequests();
    } catch (error) { this.setData({ uncertain: unknownResult(error) || Boolean(this.data.pending), confirmUncertain: unknownResult(error),
      error: unknownResult(error) ? this.data.copy.checkAssessmentConfirmation : errorText(error) }); }
    finally { this.setData({ busy: false, busyId: "" }); }
  },
  login() { loginPage("/pages/assessment/index" + (this.data.showHistory ? "?view=history" : "")); },
  register() { wx.navigateTo({ url: "/pages/register/index?source=assessment" }); },
});
