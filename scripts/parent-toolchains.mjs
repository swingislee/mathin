import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function available(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000, windowsHide: true });
  return !result.error && result.status === 0;
}
const windows = process.platform === "win32";
const java = windows && existsSync("C:/Program Files/Android/Android Studio/jbr/bin/java.exe")
  ? "C:/Program Files/Android/Android Studio/jbr/bin/java.exe"
  : process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, "bin", windows ? "java.exe" : "java")
    : "java";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  (windows ? path.join(os.homedir(), "AppData/Local/Android/Sdk") :
    process.platform === "darwin" ? path.join(os.homedir(), "Library/Android/sdk") : "");
console.log("Node：" + process.version);
console.log("微信：请用微信开发者工具导入 apps/parent-wechat；CLI 类型检查使用 pnpm parents:check。");
console.log("Java：" + (available(java, ["-version"]) ? "可用（" + java + "）" :
  existsSync(java) ? "已找到 " + java + "，当前进程未能执行版本检查。" : "未检测到，请配置 JAVA_HOME"));
console.log("Android SDK：" + (sdk && existsSync(sdk) ? sdk : "未检测到，请配置 ANDROID_HOME"));
if (sdk && existsSync(path.join(sdk, "platforms"))) {
  console.log("Android platforms：" + readdirSync(path.join(sdk, "platforms")).join(", "));
}
console.log("Xcode：" + (process.platform === "darwin" && available("xcodebuild", ["-version"])
  ? "可用" : "iOS 构建需要 Mac 上的 Xcode；源码与接口可在当前系统维护。"));
