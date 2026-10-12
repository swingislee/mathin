import { get, getAssessments, getAssessmentSlots, postAssessment, requestId, session, ApiError } from "../../lib/api";
import type { Account, Participant, AssessmentOverview, AssessmentRequest, AssessmentState, AssessmentAvailability, AssessmentTopic } from "../../lib/api-types";
import { pageData, syncPage, errorText, loginPage } from "../../lib/page";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { assessmentTimeLabel, futureAssessmentOption } from "../../lib/assessment-calendar";
import { assessmentFields, bookedTimeLabel, publishedAssessmentGrid } from "../../lib/assessment-booking";
import { pendingAssessment, savePendingAssessment, clearPendingAssessment, type PendingAssessmentRequest } from "../../lib/assessment-pending";

type RequestView = AssessmentRequest & { facilitatorName: string; statusLabel: string; confirmedTimeLabel: string;
  preferredLabel: string; detailsLabel: string; confirmOptions: { value: string; label: string }[] };
type Choice = { id: string; name: string; available: boolean };
const unknownResult = (error: unknown) => !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "CONFLICT", "UNAUTHENTICATED"].includes(error.code);

Page({
  data: { ...pageData("discover"), ...assessmentFields("zh", [], null), authenticated: false, loaded: false,
    accountId: "", participants: [] as Participant[], selected: 0, overview: null as AssessmentOverview | null,
    selectedTopics: [] as AssessmentTopic[], draftTopics: [] as AssessmentTopic[], stageNumber: null as number | null, mode: "",
    availability: null as AssessmentAvailability | null, availabilityLoading: false, campusId: "", facilitatorId: "",
    campuses: [] as Choice[], facilitators: [] as Choice[], selectedSlotId: "", selectedLabel: "", weekIndex: 0,
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
      selectedTopics: [], draftTopics: [], stageNumber: null, mode: "", confirmationId: "", confirmationTime: "" });
    this.renderFields(); this.clearAvailability();
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; this.availabilityVersion++; this.setData({ sheet: "" }); },
  configurationChanged() { this.renderFields(); },
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
      selectedTopics: [], draftTopics: [], stageNumber: null, mode: "", step: 1, requestSent: false,
      confirmationId: "", confirmationTime: "", pending, pendingChecked: false, uncertain: Boolean(pending) });
    this.renderFields();
    try {
      const overview = await getAssessments(participant.id);
      if (version !== this.loadVersion) return;
      if (overview.participantId !== participant.id || overview.timeZone !== "Asia/Shanghai") throw new Error("Unexpected assessment participant");
      const recovered = pending && overview.requests.some(row => row.id === pending.id && row.participantId === participant.id);
      if (recovered) clearPendingAssessment(this.data.accountId, participant.id);
      // 已发布的诊断人员不要求与参与人的既有分组关联。
      const eligible = overview.eligibility.canRequest || overview.eligibility.reason === "NO_ELIGIBLE_FACILITATOR";
      this.setData({ overview, eligible,
        eligibilityHint: eligible ? "" : overview.eligibility.reason === "ACTIVE_INVITATION" ? this.data.copy.assessmentActive : this.data.copy.assessmentProfileNeeded,
        loaded: true, pending: recovered ? null : pending, pendingChecked: Boolean(pending && !recovered), uncertain: Boolean(pending && !recovered), confirmUncertain: false,
        error: pending && !recovered ? this.data.copy.checkAssessment : "",
        showHistory: this.data.showHistory || Boolean(recovered) || overview.eligibility.reason === "ACTIVE_INVITATION" });
      this.renderRequests(); this.renderFields();
    } catch (error) {
      if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) });
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  stateLabel(state: AssessmentState) {
    const copy = this.data.copy;
    return ({ coordinating_time: copy.assessmentCoordinating, awaiting_facilitator: copy.awaitingFacilitator,
      awaiting_participant: copy.awaitingParticipant, confirmed: copy.assessmentConfirmed, completed: copy.assessmentCompleted, cancelled: copy.cancelled })[state];
  },
  renderRequests() {
    const participant = this.data.participants[this.data.selected];
    const requests = (this.data.overview?.requests || []).filter(row => row.participantId === participant?.id).map(row => {
      const confirmOptions = row.canConfirm && row.state === "awaiting_participant" ? row.sharedTimeOptions
        .filter(option => !option.endsWith("@after_school") && futureAssessmentOption(option)
          && row.participantTimeOptions.includes(option) && row.facilitatorTimeOptions.includes(option))
        .map(value => ({ value, label: assessmentTimeLabel(value, this.data.copy.afterSchool) })) : [];
      const confirmedTimeToken = row.confirmedStartsAt ? new Date(Date.parse(row.confirmedStartsAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", "@") : "";
      const fields = row.booking ? assessmentFields(this.data.locale === "en" ? "en" : "zh", row.booking.topics, row.booking.stageNumber, this.data.overview?.topics) : null;
      return { ...row, facilitatorName: row.facilitator?.displayName || this.data.copy.toBeConfirmed, statusLabel: this.stateLabel(row.state),
        confirmedTimeLabel: ["confirmed", "completed"].includes(row.state) && confirmedTimeToken
          ? row.booking ? bookedTimeLabel(row.confirmedStartsAt!, row.booking.endsAt, this.data.copy.fullWeekdays.split(",")) : assessmentTimeLabel(confirmedTimeToken, this.data.copy.afterSchool) : "",
        detailsLabel: fields && row.booking ? [fields.topicLabel, fields.stageLabel, this.data.copy.onsiteAssessment, row.booking.campus.name].join(" · ") : "",
        preferredLabel: row.participantTimeOptions.map(option => assessmentTimeLabel(option, this.data.copy.afterSchool)).join("、"), confirmOptions };
    });
    this.setData({ requests });
  },
  renderFields() { this.setData(assessmentFields(this.data.locale === "en" ? "en" : "zh", this.data.selectedTopics, this.data.stageNumber, this.data.overview?.topics)); },
  clearAvailability() {
    this.availabilityVersion++;
    this.setData({ availability: null, availabilityLoading: false, campusId: "", facilitatorId: "", selectedSlotId: "", weekIndex: 0 });
    this.renderTimes();
  },
  renderTimes() {
    const availability = this.data.availability, now = Date.now();
    const available = (slot: NonNullable<typeof availability>["slots"][number]) => slot.available && Date.parse(slot.startsAt) > now;
    const campuses = (availability?.campuses || []).map(campus => ({ ...campus,
      available: availability!.slots.some(slot => slot.campusId === campus.id && available(slot)) }));
    const facilitators = (availability?.facilitators || []).filter(facilitator => availability!.slots.some(slot => slot.campusId === this.data.campusId && slot.facilitatorId === facilitator.id))
      .map(facilitator => ({ id: facilitator.id, name: facilitator.displayName,
        available: availability!.slots.some(slot => slot.campusId === this.data.campusId && slot.facilitatorId === facilitator.id && available(slot)) }));
    const selectedSlot = availability?.slots.find(slot => slot.id === this.data.selectedSlotId && slot.campusId === this.data.campusId && slot.facilitatorId === this.data.facilitatorId && available(slot));
    const selectedSlotId = selectedSlot?.id || "";
    const grid = publishedAssessmentGrid({ availability, campusId: this.data.campusId, facilitatorId: this.data.facilitatorId,
      weekIndex: this.data.weekIndex, selectedSlotId, weekdays: this.data.copy.fullWeekdays.split(","), periods: this.data.copy.assessmentPeriods.split(","), now });
    this.setData({ ...grid, campuses, facilitators, selectedSlotId,
      selectedLabel: selectedSlot ? bookedTimeLabel(selectedSlot.startsAt, selectedSlot.endsAt, this.data.copy.fullWeekdays.split(",")) : "" });
  },
  async loadAvailability() {
    const participant = this.data.participants[this.data.selected];
    if (!participant || !this.data.selectedTopics.length || this.data.stageNumber === null || this.data.mode !== "campus" || this.data.busy) return;
    const version = ++this.availabilityVersion;
    this.setData({ availabilityLoading: true, error: "" });
    try {
      const availability = await getAssessmentSlots(participant.id, this.data.selectedTopics, this.data.stageNumber);
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
    this.setData({ sheet, draftTopics: [...this.data.selectedTopics] });
    if (sheet === "topic") this.setData({ topicOptions: assessmentFields(this.data.locale === "en" ? "en" : "zh", this.data.draftTopics, this.data.stageNumber, this.data.overview?.topics).topicOptions });
  },
  closeSheet() { this.setData({ sheet: "" }); },
  noop() {},
  chooseParticipant(e: WechatMiniprogram.TouchEvent) {
    const selected = Number(e.currentTarget.dataset.index);
    if (this.data.busy || !this.data.participants[selected]) return;
    this.setData({ sheet: "" });
    if (selected !== this.data.selected) { this.setData({ selected }); void this.loadParticipant(); }
  },
  toggleTopic(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id) as AssessmentTopic;
    if (this.data.busy || this.data.uncertain || !(this.data.overview?.topics || []).some(topic => topic.available && topic.id === id)) return;
    const draftTopics = this.data.draftTopics.includes(id) ? this.data.draftTopics.filter(topic => topic !== id) : [...this.data.draftTopics, id];
    this.setData({ draftTopics, topicOptions: assessmentFields(this.data.locale === "en" ? "en" : "zh", draftTopics, this.data.stageNumber, this.data.overview?.topics).topicOptions });
  },
  confirmTopics() {
    if (this.data.busy || this.data.uncertain || !this.data.draftTopics.length) return;
    const selectedTopics = (this.data.overview?.topics || []).filter(topic => topic.available && this.data.draftTopics.includes(topic.id)).map(topic => topic.id);
    if (selectedTopics.join(",") !== this.data.selectedTopics.join(",")) this.clearAvailability();
    this.setData({ selectedTopics, sheet: "" }); this.renderFields();
  },
  chooseStage(e: WechatMiniprogram.TouchEvent) {
    const stageNumber = Number(e.currentTarget.dataset.stageNumber);
    if (this.data.busy || this.data.uncertain || !this.data.stageOptions.some(group => group.stages.some(stage => stage.stageNumber === stageNumber))) return;
    if (stageNumber !== this.data.stageNumber) this.clearAvailability();
    this.setData({ stageNumber, sheet: "" }); this.renderFields();
  },
  chooseMode() { if (!this.data.busy && !this.data.uncertain) this.setData({ mode: "campus", sheet: "" }); },
  chooseCampus(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (this.data.busy || this.data.uncertain || !this.data.campuses.some(campus => campus.id === id && campus.available)) return;
    if (id !== this.data.campusId) this.setData({ campusId: id, facilitatorId: "", selectedSlotId: "" });
    this.renderTimes();
  },
  chooseFacilitator(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (this.data.busy || this.data.uncertain || !this.data.facilitators.some(facilitator => facilitator.id === id && facilitator.available)) return;
    if (id !== this.data.facilitatorId) this.setData({ facilitatorId: id, selectedSlotId: "" });
    this.renderTimes();
  },
  async review() {
    if (this.data.loaded && this.data.eligible && this.data.selectedTopics.length && this.data.stageNumber !== null && this.data.mode === "campus" && !this.data.busy && !this.data.uncertain) {
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
    if (!this.data.busy && !this.data.uncertain) { this.setData({ campusId: "", facilitatorId: "", selectedSlotId: "", weekIndex: 0 }); this.renderTimes(); }
  },
  toggleHistory() { if (!this.data.busy) this.setData({ showHistory: !this.data.showHistory, sheet: "", requestSent: false }); },
  viewHistory() { if (!this.data.busy) { this.setData({ showHistory: true }); void this.load(); } },
  retryLoad() { if (this.data.step === 2 && !this.data.uncertain) void this.loadAvailability(); else void this.load(); },
  async submit() {
    if (this.data.busy || this.data.uncertain || this.data.availabilityLoading || !this.data.loaded || !this.data.eligible || this.data.step !== 2 || this.data.stageNumber === null) return;
    this.renderTimes();
    if (!this.data.selectedSlotId) return;
    await this.sendRequest({ id: requestId(), slotId: this.data.selectedSlotId, topics: [...this.data.selectedTopics], stageNumber: this.data.stageNumber, mode: "campus" });
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
      || this.data.confirmationId !== id || !request.canConfirm || request.state !== "awaiting_participant"
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
