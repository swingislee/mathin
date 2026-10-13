import { get, experienceRequest, session } from "../../lib/api";
import { accountRecordSources, type AccountRecordSource, type ExperienceLocale } from "../../lib/miniapp-experience";
import { accountRecordRows, accountRecordTargets, type AccountRecordData, type AccountRecordRow } from "../../lib/miniapp-records";
import { date, errorText, loginPage } from "../../lib/page";
import { openConfiguredAction } from "../../lib/miniapp-configuration";
import { openPage } from "../../lib/navigation";
import type { MiniappAction } from "../../lib/miniapp-settings";
const runtime = new WeakMap<object, { active: boolean; generation: number; key: string }>();
async function readRows(source: AccountRecordSource, locale: ExperienceLocale) {
  switch (source) {
    case "activityBookings": return accountRecordRows(source, await get<AccountRecordData["activityBookings"]>("bookings"), locale);
    case "reports": return accountRecordRows(source, await get<AccountRecordData["reports"]>("reports"), locale);
    case "tasks": return accountRecordRows(source, await get<AccountRecordData["tasks"]>("tasks"), locale);
    case "serviceBookings": return accountRecordRows(source, await experienceRequest<AccountRecordData["serviceBookings"]>("bookings?page=1"), locale);
    case "serviceRequests": return accountRecordRows(source, await experienceRequest<AccountRecordData["serviceRequests"]>("requests?page=1"), locale);
    case "notifications": return accountRecordRows(source, await experienceRequest<AccountRecordData["notifications"]>("notifications"), locale);
  }
}
Component({
  properties: { source: String, limit: { type: Number, value: 3 }, density: { type: String, value: "comfortable" }, emptyText: String, locale: { type: String, value: "zh" } },
  data: { authenticated: false, loading: false, error: "", rows: [] as AccountRecordRow[] },
  lifetimes: { attached() { runtime.set(this, { active: true, generation: 0, key: "" }); void this.load(); }, detached() { runtime.delete(this); } },
  pageLifetimes: {
    show() { const state = runtime.get(this); if (state) { state.active = true; void this.load(); } },
    hide() { const state = runtime.get(this); if (state) { state.active = false; state.generation++; state.key = ""; } this.setData({ rows: [], loading: false, error: "", authenticated: false }); },
  },
  observers: { "source, limit, locale"() { if (runtime.get(this)?.active) void this.load(); } },
  methods: {
    async load() {
      const state = runtime.get(this), source = this.data.source as AccountRecordSource;
      if (!state?.active || !(accountRecordSources as readonly string[]).includes(source)) return;
      const token = session()?.accessToken || "", key = `${source}:${this.data.limit}:${this.data.locale}:${token}`;
      // The auth comparison key stays in JS memory; it is never sent into rendering data or stored with content.
      if (state.key === key) return;
      state.key = key; const generation = ++state.generation;
      this.setData({ authenticated: !!token, loading: !!token, error: "", rows: [] });
      if (!token) return;
      try {
        const rows = await readRows(source, this.data.locale === "en" ? "en" : "zh");
        if (runtime.get(this) !== state || !state.active || state.generation !== generation) return;
        if (session()?.accessToken !== token) { state.key = ""; this.setData({ authenticated: !!session(), rows: [] }); return; }
        this.setData({ rows: rows.slice(0, Math.min(30, Math.max(1, this.data.limit))).map(row => ({ ...row, time: date(row.time) })) });
      } catch (error) { if (runtime.get(this) === state && state.active && generation === state.generation) { state.key = ""; this.setData({ error: errorText(error) }); } }
      finally { if (runtime.get(this) === state && state.active && generation === state.generation) this.setData({ loading: false }); }
    },
    open(e: WechatMiniprogram.CustomEvent) { const row = this.data.rows.find(r => r.id === e.currentTarget.dataset.id); if (row && session()) openPage(row.path); },
    all() { const action = accountRecordTargets[this.data.source as AccountRecordSource]; if (action) openConfiguredAction(action as MiniappAction); },
    login() {
      const pages = getCurrentPages(), page = pages[pages.length - 1];
      const options = page?.options || {}, query = Object.keys(options).map(key => encodeURIComponent(key) + "=" + encodeURIComponent(options[key] || "")).join("&");
      loginPage(page ? "/" + page.route + (query ? "?" + query : "") : undefined);
    },
  },
});
