import type { ExperienceAction } from "./miniapp-experience";
import { openConfiguredAction } from "./miniapp-configuration";
import type { MiniappAction } from "./miniapp-settings";
export function openExperienceAction(action?: ExperienceAction) {
  if (!action || action.kind === "none") return;
  if (action.kind === "phone") { if (/^\+?[0-9 ()-]{6,30}$/.test(action.target)) wx.makePhoneCall({ phoneNumber: action.target }); return; }
  if (action.kind === "native") { openConfiguredAction(action.target as MiniappAction); return; }
  openConfiguredAction(action.kind, action.target);
}
