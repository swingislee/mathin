// 只在当前运行中保存返回位置和所选 ID，账号退出时一起清除。
import { nativeScreenIds } from "./miniapp-native";
let returnPath = "";
let loginRequested = false;
let participantId = "";
const tabs = ["discover", "calendar", "account"];
function isDestination(url: string): boolean {
  const match = /^\/pages\/([a-z-]+)\/index(\?[^#]*)?$/.exec(url);
  return !!match && (nativeScreenIds as readonly string[]).includes(match[1]) && !(tabs.includes(match[1]) && match[2]);
}

export function openPage(url: string) {
  if (tabs.some(tab => url === `/pages/${tab}/index`)) wx.switchTab({ url });
  else if (isDestination(url)) wx.navigateTo({ url });
}
export function rememberReturn(url: unknown) {
  returnPath = typeof url === "string" && isDestination(url) ? url : "";
}
export function requestLogin(url: unknown) { rememberReturn(url); loginRequested = true; }
export function takeLoginRequest() { const requested = loginRequested; loginRequested = false; return requested; }
export function cancelLogin() { returnPath = ""; loginRequested = false; }
export function resumeAfterLogin() {
  const target = returnPath;
  cancelLogin();
  if (target) openPage(target);
  return Boolean(target);
}
export function selectedParticipant() { return participantId; }
export function hasReturn() { return Boolean(returnPath); }
export function selectParticipant(id: string) { participantId = id; }
export function clearNavigation() { cancelLogin(); participantId = ""; }
