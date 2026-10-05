import { ApiError, get, courseCatalog, courseApplications, courseCommand, requestId, session } from "../../lib/api";
import type { Account, Participant, CourseOffer, CourseApplicationCommand } from "../../lib/api-types";
import { courseCopy, coursePrice, classTimes, matchingClasses, classTimeGrid } from "../../lib/course-catalog";
import { pageData, syncPage, currentLocale, errorText, loginPage } from "../../lib/page";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";

type ApplyCommand = Extract<CourseApplicationCommand, { action: "apply" }>;
const pendingKey = (account: string, offer: string) => `gezhi.course-application.v1.${account}.${offer}`;
Page({
  data: { ...pageData("discover"), t: courseCopy.zh, id: "", authenticated: false, accountId: "", offer: null as CourseOffer | null,
    participants: [] as Participant[], selected: 0, level: "", campus: "", teacher: "", classId: "", classLabel: "", price: "",
    levels: [] as { id: string; name: string }[], campuses: [] as { id: string; name: string }[], teachers: [] as { id: string; name: string }[],
    grid: classTimeGrid([], "zh"), unscheduled: [] as { id: string; name: string; full: boolean }[], matched: 0,
    busy: false, pending: null as ApplyCommand | null, sent: false },
  version: 0,
  visible: false,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() {
    this.visible = true;
    syncPage(this, "discover"); this.setData({ t: courseCopy[currentLocale()], authenticated: Boolean(session()) });
    if (!this.data.busy) void this.load();
  },
  onHide() { this.visible = false; this.version++; },
  async load() {
    const version = ++this.version;
    this.setData({ loading: true, error: "", accountId: "", participants: [], offer: null, classId: "", classLabel: "", pending: null, sent: false });
    if (!session()) { this.setData({ loading: false }); return; }
    try {
      const [account, offers, applications] = await Promise.all([get<Account>("account"), courseCatalog(), courseApplications()]);
      if (version !== this.version) return;
      const offer = offers.find(o => o.id === this.data.id) || null;
      const stored = wx.getStorageSync(pendingKey(account.id, this.data.id)) as ApplyCommand | null;
      const pending = stored?.action === "apply" && stored.publicationId === this.data.id ? stored : null;
      const sent = Boolean(pending && applications.some(a => a.id === pending.id));
      if (sent) wx.removeStorageSync(pendingKey(account.id, this.data.id));
      this.setData({ accountId: account.id, offer, participants: account.participants,
        selected: Math.max(0, account.participants.findIndex(p => p.id === selectedParticipant())),
        price: offer ? coursePrice(offer.priceCents, currentLocale()) : "", pending: sent ? null : pending, sent,
        error: pending && !sent ? this.data.t.unknown : !offer && !sent ? this.data.t.closed : "" });
      this.renderChoices();
    } catch (error) { if (version === this.version) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  renderChoices() {
    const all = this.data.offer?.classes || [];
    const levelRows = this.data.level ? all.filter(c => c.level === this.data.level) : all;
    const campusRows = this.data.campus ? levelRows.filter(c => (c.campusId || "pending") === this.data.campus) : levelRows;
    const rows = matchingClasses(all, this.data);
    const uniq = (list: { id: string; name: string }[]) => list.filter((x, i) => list.findIndex(y => y.id === x.id) === i);
    this.setData({ levels: uniq(all.map(c => ({ id: c.level, name: c.level }))),
      campuses: uniq(levelRows.map(c => ({ id: c.campusId || "pending", name: c.campusName || this.data.t.pendingCampus }))),
      teachers: uniq(campusRows.reduce((list, c) => list.concat(c.teachers), [] as { id: string; name: string }[])),
      grid: classTimeGrid(rows, currentLocale()), matched: rows.length,
      unscheduled: rows.filter(c => !c.sessions.length).map(c => ({ id: c.id, name: c.name, full: c.remaining === 0 })) });
  },
  filter(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || this.data.pending) return;
    const key = String(e.currentTarget.dataset.key), value = String(e.currentTarget.dataset.id);
    if (!['level', 'campus', 'teacher'].includes(key)) return;
    this.setData({ [key]: this.data[key as "level" | "campus" | "teacher"] === value ? "" : value, classId: "", classLabel: "",
      ...(key === "level" ? { campus: "", teacher: "" } : key === "campus" ? { teacher: "" } : {}) }); this.renderChoices();
  },
  reset() { if (this.data.busy || this.data.pending) return; this.setData({ level: "", campus: "", teacher: "", classId: "", classLabel: "" }); this.renderChoices(); },
  chooseClass(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || this.data.pending) return;
    const row = matchingClasses(this.data.offer?.classes || [], this.data).find(c => c.id === e.currentTarget.dataset.id);
    if (!row || row.remaining === 0) return;
    this.setData({ classId: row.id, classLabel: [row.name, row.campusName || this.data.t.pendingCampus, row.teachers.map(t => t.name).join("、") || this.data.t.pendingTeacher, classTimes(row, currentLocale()), `${row.sessions.length} ${this.data.t.lessons}`].join(" · ") });
  },
  participant(e: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.pending) return;
    const selected = Number(e.detail.value); const row = this.data.participants[selected];
    if (row) { selectParticipant(row.id); this.setData({ selected, classId: "", classLabel: "" }); }
  },
  jump(e: WechatMiniprogram.TouchEvent) { const section = String(e.currentTarget.dataset.section); if (["level", "campus", "teacher", "time"].includes(section)) wx.pageScrollTo({ selector: "#choose-" + section, duration: 200 }); },
  login() { loginPage("/pages/course-select/index?id=" + encodeURIComponent(this.data.id)); },
  applications() { wx.navigateTo({ url: "/pages/course-applications/index" }); },
  async submit() {
    if (this.data.busy || this.data.loading || !this.data.authenticated || !this.data.accountId) return;
    const version = this.version;
    const accountId = this.data.accountId;
    const offerId = this.data.id;
    const offer = this.data.offer;
    const participant = this.data.participants[this.data.selected];
    const classroomId = this.data.classId;
    let command = this.data.pending;
    const key = pendingKey(accountId, offerId);
    this.setData({ busy: true, error: "" });
    try {
      if (!command) {
        if (!offer || !classroomId || !participant) { this.setData({ error: this.data.t.chooseHint }); return; }
        const approval = await wx.showModal({ title: this.data.t.applicationPrompt, content: this.data.t.submitNote });
        if (!approval.confirm || version !== this.version || accountId !== this.data.accountId || !session()) return;
        command = { action: "apply", id: requestId(), publicationId: offerId, revision: offer.revision, classroomId, participantId: participant.id };
      }
      wx.setStorageSync(key, command);
      this.setData({ pending: command });
      const result = await courseCommand(command);
      if (result.id !== command.id) throw new Error("Unexpected application");
      wx.removeStorageSync(key);
      if (version === this.version) this.setData({ pending: null, sent: true });
    } catch (error) {
      const unknown = !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "UNAUTHENTICATED"].includes(error.code);
      if (!unknown) wx.removeStorageSync(key);
      if (version === this.version) this.setData({ pending: unknown ? command : null, error: unknown ? this.data.t.unknown : errorText(error) });
    } finally {
      this.setData({ busy: false });
      if (this.visible && version !== this.version) void this.load();
    }
  },
});
