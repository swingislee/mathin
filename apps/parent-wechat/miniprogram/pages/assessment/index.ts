import { get, getAssessments, getAssessmentSlots, postAssessment, requestId, session, ApiError } from "../../lib/api";
import type { Account, Participant, ParentAssessmentOverview, ParentAssessmentRequest, AssessmentState, AssessmentAvailability, AssessmentSubject } from "../../lib/api-types";
import { pageData, syncPage, errorText, loginPage } from "../../lib/page";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { assessmentTimeLabel, futureAssessmentOption } from "../../lib/assessment-calendar";
import { assessmentFields, assessmentSubjects, bookedTimeLabel, publishedAssessmentGrid } from "../../lib/assessment-booking";
import { pendingAssessment, savePendingAssessment, clearPendingAssessment, type PendingAssessmentRequest } from "../../lib/assessment-pending";

type RequestView = ParentAssessmentRequest & { teacherName: string; statusLabel: string; scheduledLabel: string;
  preferredLabel: string; detailsLabel: string; confirmOptions: { value: string; label: string }[] };
type Choice = { id: string; name: string; available: boolean };
const unknownResult = (error: unknown) => !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "CONFLICT", "UNAUTHENTICATED"].includes(error.code);

Page({
  data: { ...pageData("discover"), ...assessmentFields("zh", [], null), authenticated: false, loaded: false,
    accountId: "", participants: [] as Participant[], selected: 0, overview: null as ParentAssessmentOverview | null,
    selectedSubjects: [] as AssessmentSubject[], draftSubjects: [] as AssessmentSubject[], grade: null as number | null, mode: "",
    availability: null as AssessmentAvailability | null, availabilityLoading: false, campusId: "", teacherId: "",
    campuses: [] as Choice[], teachers: [] as Choice[], selectedSlotId: "", selectedLabel: "", weekIndex: 0,
    weeks: [] as ReturnType<typeof publishedAssessmentGrid>["weeks"], days: [] as ReturnType<typeof publishedAssessmentGrid>["days"],
    timeRows: [] as ReturnType<typeof publishedAssessmentGrid>["timeRows"],
    weekLabel: "",
    requests: [] as RequestView[], eligible: false, eligibilityHint: "", sheet: "", showHistory: false, step: 1,
    busy: false, busyId: "", uncertain: false, confirmUncertain: false, pending: null as PendingAssessmentRequest | null,
    pendingChecked: false, requestSent: false, requestSentStatus: "", confirmationId: "", confirmationTime: "" },
  loadVersion: 0,
  availabilityVersion: 0,
  onLoad(query: Record<string, string>) { this.setData({ showHistory: query.view === "history" }); },
  onShow() {
    syncPage(this, "discover", "assessmentBooking");
    if (this.data.busy) return;
    this.setData({ authenticated: Boolean(session()), loaded: false, loading: false, accountId: "", participants: [],
      overview: null, requests: [], eligible: false, eligibilityHint: "", error: "", step: 1, sheet: "",
      uncertain: false, confirmUncertain: false, pending: null, pendingChecked: false, requestSent: false,
      selectedSubjects: [], draftSubjects: [], grade: null, mode: "", confirmationId: "", confirmationTime: "" });
    this.renderFields(); this.clearAvailability();
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; this.availabilityVersion++; this.setData({ sheet: "" }); },
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
    this.clearAvailability();
    this.setData({ loading: true, loaded: false, error: "", overview: null, requests: [], eligible: false, eligibilityHint: "",
      selectedSubjects: [], draftSubjects: [], grade: null, mode: "", step: 1, requestSent: false,
      confirmationId: "", confirmationTime: "", pending, pendingChecked: false, uncertain: Boolean(pending) });
    this.renderFields();
    try {
      const overview = await getAssessments(participant.id);
      if (version !== this.loadVersion) return;
      if (overview.participantId !== participant.id || overview.timeZone !== "Asia/Shanghai") throw new Error("Unexpected assessment participant");
      const recovered = pending && overview.requests.some(row => row.id === pending.id && row.participantId === participant.id);
      if (recovered) clearPendingAssessment(this.data.accountId, participant.id);
      // 已发布的测评老师不要求是孩子现有班级的任课老师。
      const eligible = overview.eligibility.canRequest || overview.eligibility.reason === "NO_ELIGIBLE_TEACHER";
      this.setData({ overview, eligible,
        eligibilityHint: eligible ? "" : overview.eligibility.reason === "ACTIVE_INVITATION" ? this.data.copy.assessmentActive : this.data.copy.assessmentProfileNeeded,
        loaded: true, pending: recovered ? null : pending, pendingChecked: Boolean(pending && !recovered), uncertain: Boolean(pending && !recovered), confirmUncertain: false,
        error: pending && !recovered ? this.data.copy.checkAssessment : "",
        showHistory: this.data.showHistory || Boolean(recovered) || overview.eligibility.reason === "ACTIVE_INVITATION" });
      this.renderRequests();
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
      const fields = row.booking ? assessmentFields(this.data.locale === "en" ? "en" : "zh", row.booking.subjects, row.booking.grade) : null;
      return { ...row, teacherName: row.teacher?.displayName || this.data.copy.toBeConfirmed, statusLabel: this.stateLabel(row.state),
        scheduledLabel: ["confirmed", "completed"].includes(row.state) && scheduledToken
          ? row.booking ? bookedTimeLabel(row.scheduledAt!, row.booking.endsAt, this.data.copy.fullWeekdays.split(",")) : assessmentTimeLabel(scheduledToken, this.data.copy.afterSchool) : "",
        detailsLabel: fields && row.booking ? [fields.subjectLabel, fields.gradeLabel, this.data.copy.onsiteAssessment, row.booking.campus.name].join(" · ") : "",
        preferredLabel: row.parentTimeOptions.map(option => assessmentTimeLabel(option, this.data.copy.afterSchool)).join("、"), confirmOptions };
    });
    this.setData({ requests });
  },
  renderFields() { this.setData(assessmentFields(this.data.locale === "en" ? "en" : "zh", this.data.selectedSubjects, this.data.grade)); },
  clearAvailability() {
    this.availabilityVersion++;
    this.setData({ availability: null, availabilityLoading: false, campusId: "", teacherId: "", selectedSlotId: "", weekIndex: 0 });
    this.renderTimes();
  },
  renderTimes() {
    const availability = this.data.availability, now = Date.now();
    const available = (slot: NonNullable<typeof availability>["slots"][number]) => slot.available && Date.parse(slot.startsAt) > now;
    const campuses = (availability?.campuses || []).map(campus => ({ ...campus,
      available: availability!.slots.some(slot => slot.campusId === campus.id && available(slot)) }));
    const teachers = (availability?.teachers || []).filter(teacher => availability!.slots.some(slot => slot.campusId === this.data.campusId && slot.teacherId === teacher.id))
      .map(teacher => ({ id: teacher.id, name: teacher.displayName,
        available: availability!.slots.some(slot => slot.campusId === this.data.campusId && slot.teacherId === teacher.id && available(slot)) }));
    const selectedSlot = availability?.slots.find(slot => slot.id === this.data.selectedSlotId && slot.campusId === this.data.campusId && slot.teacherId === this.data.teacherId && available(slot));
    const selectedSlotId = selectedSlot?.id || "";
    const grid = publishedAssessmentGrid({ availability, campusId: this.data.campusId, teacherId: this.data.teacherId,
      weekIndex: this.data.weekIndex, selectedSlotId, weekdays: this.data.copy.fullWeekdays.split(","), periods: this.data.copy.assessmentPeriods.split(","), now });
    this.setData({ ...grid, campuses, teachers, selectedSlotId,
      selectedLabel: selectedSlot ? bookedTimeLabel(selectedSlot.startsAt, selectedSlot.endsAt, this.data.copy.fullWeekdays.split(",")) : "" });
  },
  async loadAvailability() {
    const participant = this.data.participants[this.data.selected];
    if (!participant || !this.data.selectedSubjects.length || this.data.grade === null || this.data.mode !== "campus" || this.data.busy) return;
    const version = ++this.availabilityVersion;
    this.setData({ availabilityLoading: true, error: "" });
    try {
      const availability = await getAssessmentSlots(participant.id, this.data.selectedSubjects, this.data.grade);
      if (version !== this.availabilityVersion) return;
      if (availability.participantId !== participant.id || availability.timeZone !== "Asia/Shanghai") throw new Error("Unexpected assessment availability");
      this.setData({ availability }); this.renderTimes();
    } catch (error) {
      if (version === this.availabilityVersion) { this.setData({ availability: null, error: errorText(error), authenticated: Boolean(session()) }); this.renderTimes(); }
    } finally { if (version === this.availabilityVersion) this.setData({ availabilityLoading: false }); }
  },
  showSheet(e: WechatMiniprogram.TouchEvent) {
    const sheet = String(e.currentTarget.dataset.sheet);
    if (this.data.busy || this.data.loading || (this.data.uncertain && sheet !== "participant")) return;
    this.setData({ sheet, draftSubjects: [...this.data.selectedSubjects] });
    if (sheet === "subject") this.setData({ subjectOptions: assessmentFields(this.data.locale === "en" ? "en" : "zh", this.data.draftSubjects, this.data.grade).subjectOptions });
  },
  closeSheet() { this.setData({ sheet: "" }); },
  noop() {},
  chooseParticipant(e: WechatMiniprogram.TouchEvent) {
    const selected = Number(e.currentTarget.dataset.index);
    if (this.data.busy || !this.data.participants[selected]) return;
    this.setData({ sheet: "" });
    if (selected !== this.data.selected) { this.setData({ selected }); void this.loadParticipant(); }
  },
  toggleSubject(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id) as AssessmentSubject;
    if (this.data.busy || this.data.uncertain || !assessmentSubjects.some(subject => subject.id === id)) return;
    const draftSubjects = this.data.draftSubjects.includes(id) ? this.data.draftSubjects.filter(subject => subject !== id) : [...this.data.draftSubjects, id];
    this.setData({ draftSubjects, subjectOptions: assessmentFields(this.data.locale === "en" ? "en" : "zh", draftSubjects, this.data.grade).subjectOptions });
  },
  confirmSubjects() {
    if (this.data.busy || this.data.uncertain || !this.data.draftSubjects.length) return;
    const selectedSubjects = assessmentSubjects.filter(subject => this.data.draftSubjects.includes(subject.id)).map(subject => subject.id);
    if (selectedSubjects.join(",") !== this.data.selectedSubjects.join(",")) this.clearAvailability();
    this.setData({ selectedSubjects, sheet: "" }); this.renderFields();
  },
  chooseGrade(e: WechatMiniprogram.TouchEvent) {
    const grade = Number(e.currentTarget.dataset.grade);
    if (this.data.busy || this.data.uncertain || !this.data.gradeGroups.some(group => group.stages.some(stage => stage.grade === grade))) return;
    if (grade !== this.data.grade) this.clearAvailability();
    this.setData({ grade, sheet: "" }); this.renderFields();
  },
  chooseMode() { if (!this.data.busy && !this.data.uncertain) this.setData({ mode: "campus", sheet: "" }); },
  chooseCampus(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (this.data.busy || this.data.uncertain || !this.data.campuses.some(campus => campus.id === id && campus.available)) return;
    if (id !== this.data.campusId) this.setData({ campusId: id, teacherId: "", selectedSlotId: "" });
    this.renderTimes();
  },
  chooseTeacher(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (this.data.busy || this.data.uncertain || !this.data.teachers.some(teacher => teacher.id === id && teacher.available)) return;
    if (id !== this.data.teacherId) this.setData({ teacherId: id, selectedSlotId: "" });
    this.renderTimes();
  },
  async review() {
    if (this.data.loaded && this.data.eligible && this.data.selectedSubjects.length && this.data.grade !== null && this.data.mode === "campus" && !this.data.busy && !this.data.uncertain) {
      this.setData({ step: 2, error: "" }); await this.loadAvailability();
    }
  },
  back() { if (!this.data.busy && !this.data.uncertain) this.setData({ step: 1 }); },
  moveWeek(e: WechatMiniprogram.TouchEvent) {
    const weekIndex = Number(e.currentTarget.dataset.index);
    if (this.data.busy || this.data.uncertain || ![0, 1].includes(weekIndex)) return;
    this.setData({ weekIndex }); this.renderTimes();
  },
  chooseTime(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (this.data.busy || this.data.uncertain || this.data.availabilityLoading || !id
      || !this.data.timeRows.some(row => row.cells.some(cell => cell.id === id && cell.available))) return;
    this.setData({ selectedSlotId: this.data.selectedSlotId === id ? "" : id }); this.renderTimes();
  },
  resetTimes() {
    if (!this.data.busy && !this.data.uncertain) { this.setData({ campusId: "", teacherId: "", selectedSlotId: "", weekIndex: 0 }); this.renderTimes(); }
  },
  toggleHistory() { if (!this.data.busy) this.setData({ showHistory: !this.data.showHistory, sheet: "", requestSent: false }); },
  viewHistory() { if (!this.data.busy) { this.setData({ showHistory: true }); void this.load(); } },
  retryLoad() { if (this.data.step === 2 && !this.data.uncertain) void this.loadAvailability(); else void this.load(); },
  async submit() {
    if (this.data.busy || this.data.uncertain || this.data.availabilityLoading || !this.data.loaded || !this.data.eligible || this.data.step !== 2 || this.data.grade === null) return;
    this.renderTimes();
    if (!this.data.selectedSlotId) return;
    await this.sendRequest({ id: requestId(), slotId: this.data.selectedSlotId, subjects: [...this.data.selectedSubjects], grade: this.data.grade, mode: "campus" });
  },
  async retryPending() { if (this.data.pending && !this.data.busy) await this.sendRequest(this.data.pending); },
  startOver() {
    const participant = this.data.participants[this.data.selected];
    const { overview, pending } = this.data;
    if (this.data.busy || !participant || !pending || !this.data.pendingChecked || !this.data.eligible || !overview
      || overview.requests.some(row => row.id === pending.id)) return;
    clearPendingAssessment(this.data.accountId, participant.id);
    this.setData({ pending: null, pendingChecked: false, uncertain: false, error: "", showHistory: false, step: 1 });
    this.clearAvailability();
  },
  async sendRequest(pending: PendingAssessmentRequest) {
    const participant = this.data.participants[this.data.selected];
    if (this.data.busy || !participant || !this.data.accountId) return;
    const accountId = this.data.accountId;
    this.setData({ busy: true, busyId: pending.id, error: "", pendingChecked: false });
    try {
      savePendingAssessment(accountId, participant.id, pending);
      this.setData({ pending });
      const command = "slotId" in pending ? { action: "book" as const, ...pending, participantId: participant.id }
        : { action: "request" as const, ...pending, participantId: participant.id };
      const request = await postAssessment(command);
      if (request.id !== pending.id || request.participantId !== participant.id
        || ("slotId" in pending && request.booking?.slotId !== pending.slotId)) throw new Error("Unexpected assessment receipt");
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
