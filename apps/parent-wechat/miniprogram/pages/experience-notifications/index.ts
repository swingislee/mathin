import { experienceRequest, session } from "../../lib/api";
import { localText, type ExperienceText } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale, date, errorText, loginPage } from "../../lib/page";
type Notice = { id: string; title: ExperienceText; body: ExperienceText; createdAt: string };
Page({
  data: { ...pageData("discover"), authenticated: false, notices: [] as { id: string; title: string; body: string; when: string }[] },
  generation: 0,
  onShow() { syncPage(this, "discover"); this.setData({ authenticated: !!session() }); if (session()) void this.load(); },
  onHide() { this.generation++; this.setData({ notices: [], loading: false }); },
  onUnload() { this.generation++; },
  async load() {
    const generation = ++this.generation; this.setData({ loading: true, error: "" });
    try { const rows = await experienceRequest<Notice[]>("notifications"); if (generation !== this.generation) return;
      this.setData({ notices: rows.map(r => ({ id: r.id, title: localText(r.title, currentLocale()), body: localText(r.body, currentLocale()), when: date(r.createdAt) })) });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); }
    finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
  login() { loginPage("/pages/experience-notifications/index"); },
});
