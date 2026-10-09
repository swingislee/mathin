/** Preview QR codes use develop; trial/release builds must not expose the recording flow. */
export function registrationReplayAvailable(): boolean {
  try { return wx.getAccountInfoSync().miniProgram.envVersion === "develop"; }
  catch { return false; }
}

export const registrationReplayCopy = {
  zh: {
    entry: "重新走登记流程", badge: "开发版录制", note: "使用默认登记表单。提交时实际获取一次位置，填写资料不保存到后台。",
    consent: "我已阅读小程序隐私保护指引及位置用途说明，同意本次录制使用一次当前位置。",
    submit: "提交并获取本次位置", finished: "本次定位流程已结束", resultNote: "本次未创建或修改登记资料。",
    capturedAt: "定位时间", settings: "查看微信位置权限", settingsHint: "已允许的权限可能不再弹窗；关闭权限表示拒绝，不会恢复为首次授权。",
    again: "重新录制", back: "返回发现",
  },
  en: {
    entry: "Replay registration", badge: "Development recording", note: "Uses the default registration form. Submission requests your location once; form details are not saved to the server.",
    consent: "I have read the Mini Program privacy notice and location purpose, and agree to a single location request for this recording.",
    submit: "Submit and request location", finished: "Location flow finished", resultNote: "No registration records were created or changed.",
    capturedAt: "Location time", settings: "View WeChat location permission", settingsHint: "Previously granted permissions may not prompt again. Turning permission off means denied, not a first-time authorization.",
    again: "Record again", back: "Back to Discover",
  },
};
