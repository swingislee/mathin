import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (content) => createHash("sha256").update(content).digest("hex");
const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const swift = (value) => {
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), "Unsupported control character in Swift string");
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t") + '"';
};
const replaceOnce = (source, before, after) => {
  assert.equal(source.split(before).length, 2, `Template changed near ${before}`);
  return source.replace(before, after);
};

export function validateOrigin(raw) {
  const url = new URL(raw);
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "Use an origin without credentials, path or query");
  const ipv4 = url.hostname.split(".").map(Number);
  const privateHost = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && ipv4.every((part) => part >= 0 && part <= 255) &&
    (ipv4[0] === 10 || ipv4[0] === 127 || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168));
  assert(url.protocol === "https:" || (url.protocol === "http:" && privateHost), "HTTP must use a private IPv4 development host");
  // These are production targets in this repository, even on a private network.
  assert(!["192.168.5.183", "xiaomi", "mathin.club", "supabase.mathin.club"].includes(url.hostname), "This exporter is for development; production needs its release workflow");
  return url;
}

function translations(root, language) {
  const content = readFileSync(path.join(root, `MathinParent/${language}.lproj/Parent.strings`), "utf8");
  const values = [...content.matchAll(/^("(?:[^"\\]|\\.)*") = ("(?:[^"\\]|\\.)*");$/gm)].map(([, key, value]) => [JSON.parse(key), JSON.parse(value)]);
  assert(values.length > 0 && new Set(values.map(([key]) => key)).size === values.length, "Invalid localization table");
  return Object.fromEntries(values);
}

export function exportPlayground({ template, output, apiOrigin, sourceRoot = appRoot }) {
  template = path.resolve(template);
  output = path.resolve(output);
  assert(template.endsWith(".swiftpm"), "Choose a native .swiftpm template");
  assert(!existsSync(output), "Choose a new output folder; existing exports are preserved");
  const relativeOutput = path.relative(template, output);
  assert(relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput), "Keep exports outside the original template");
  const origin = validateOrigin(apiOrigin);
  const manifest = readFileSync(path.join(template, "Package.swift"), "utf8");
  const entry = readFileSync(path.join(template, "MyApp.swift"));
  assert(manifest.includes("import AppleProductTypes") && manifest.includes('.iOSApplication('), "Use an iPad app template");
  assert(entry.toString("utf8").includes("ContentView()") && (entry.toString("utf8").match(/@main/g) ?? []).length === 1, "Expected the native MyApp entry calling ContentView");
  const originalHashes = new Map(["Package.swift", "MyApp.swift", "ContentView.swift"].map((file) => [file, digest(readFileSync(path.join(template, file)))]));
  const originalManifest = manifest.replaceAll("\r\n", "\n");
  // Keep the native platform, product identity, icon and app entry. Only add LAN configuration.
  let adapted = replaceOnce(originalManifest, "            ]\n        )\n    ],", "            ],\n            additionalInfoPlistContentFilePath: \"PlaygroundInfo.plist\"\n        )\n    ],");
  adapted = replaceOnce(adapted, '            path: ".",', '            path: ".",\n            exclude: ["PlaygroundInfo.plist"],');
  adapted = replaceOnce(adapted, '            swiftSettings: [', '            swiftSettings: [\n                .define("DEBUG"),');

  const zh = translations(sourceRoot, "zh-Hans"), en = translations(sourceRoot, "en");
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "Both languages must contain the same keys");
  const sourceDirectory = path.join(sourceRoot, "MathinParent");
  const sourceFiles = readdirSync(sourceDirectory).filter((file) => file.endsWith(".swift") && file !== "MathinParentApp.swift");
  sourceFiles.push("Core/ParentModels.swift");
  const sources = sourceFiles.map((file) => [path.basename(file), readFileSync(path.join(sourceDirectory, file), "utf8").replaceAll("\r\n", "\n")]);
  assert.equal(new Set(sources.map(([file]) => file)).size, sources.length, "Flattened Swift filenames must remain unique");
  assert(sources.find(([file]) => file === "ParentRootView.swift")?.[1].includes(".task { await store.restore() }"), "Preserve real sign-in and explicit preview selection");
  assert(!sources.some(([file]) => ["MyApp.swift", "ContentView.swift", "ParentPlaygroundCopy.swift"].includes(file)), "Application sources conflict with native entry");
  const theme = sources.find(([file]) => file === "ParentTheme.swift");
  assert(theme);
  assert.equal([...theme[1].matchAll(/^func tr\(_ key: String\) -> String \{[\s\S]*?^\}/gm)].length, 1, "Localization adapter needs review");
  theme[1] = theme[1].replace(/^func tr\(_ key: String\) -> String \{[\s\S]*?^\}/m, "func tr(_ key: String) -> String {\n    ParentPlaygroundCopy.string(for: key)\n}");

  const packageDirectory = path.join(output, path.basename(template));
  mkdirSync(packageDirectory, { recursive: true });
  const write = (file, content) => writeFileSync(path.join(packageDirectory, file), content, "utf8");
  write("Package.swift", adapted);
  writeFileSync(path.join(packageDirectory, "MyApp.swift"), entry);
  for (const file of ["Workspace.plist", "DocumentThumbnail.plist", "DocumentThumbnail.png"]) {
    const relative = `.swiftpm/playgrounds/${file}`;
    const source = path.join(template, relative);
    if (existsSync(source)) {
      mkdirSync(path.dirname(path.join(packageDirectory, relative)), { recursive: true });
      copyFileSync(source, path.join(packageDirectory, relative));
      originalHashes.set(relative, digest(readFileSync(source)));
    }
  }
  // CachedManifest describes the old manifest. Let Playgrounds regenerate it after the additions.
  for (const [file, content] of sources) write(file, content);
  const dictionary = (values) => Object.entries(values).map(([key, value]) => `        ${swift(key)}: ${swift(value)},`).join("\n");
  write("ParentPlaygroundCopy.swift", `import Foundation

enum ParentPlaygroundCopy {
    static var isChinese: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") ?? true }
    static func string(for key: String) -> String {
        let values = isChinese ? chinese : english
        return values[key] ?? (key.hasPrefix("error_") ? (values["error_unavailable"] ?? "Please try again.") : key)
    }
    private static let chinese: [String: String] = [
${dictionary(zh)}
    ]
    private static let english: [String: String] = [
${dictionary(en)}
    ]
}
`);
  write("ContentView.swift", `import SwiftUI

struct ContentView: View {
    @State private var opened = false
    var body: some View {
        if opened { ParentRootView() }
        else {
            VStack(spacing: 22) {
                Image(systemName: "book.closed.fill").font(.system(size: 52)).foregroundStyle(ParentTheme.accent)
                Text("Mathin").font(.largeTitle.bold())
                Text(ParentPlaygroundCopy.isChinese ? "家长端 · 开发数据" : "Parent app · Development data").font(.title2)
                Text(ParentPlaygroundCopy.isChinese ? "使用已有家长账号登录，读取关联孩子的课程与学习记录。" : "Sign in with your existing parent account to view your children’s courses and learning records.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button(ParentPlaygroundCopy.isChinese ? "进入家长端" : "Open parent app") { opened = true }
                    .buttonStyle(.borderedProminent).controlSize(.large).tint(ParentTheme.accent)
                Text("V6").font(.caption).foregroundStyle(.secondary)
            }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
`);
  const transport = origin.protocol === "http:" ? `
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key><dict>
      <key>${xml(origin.hostname)}</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
    </dict>
  </dict>
  <key>NSLocalNetworkUsageDescription</key><string>连接局域网中的 Mathin 开发服务，读取家长账号与学习记录。Connect to your local Mathin development service.</string>` : "";
  write("PlaygroundInfo.plist", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>MathinAPIOrigin</key><string>${xml(origin.origin)}</string>${transport}
</dict></plist>
`);
  writeFileSync(path.join(output, "打开说明.txt"), `Mathin 家长端 V6

将本目录里的“${path.basename(template)}”复制到“我的 iPad”的新文件夹，用 Swift Playgrounds 打开后点击 ▶︎，再点“进入家长端”。
它已经是 .swiftpm 工程，可直接使用。

真实数据：使用已有的开发家长账号登录。服务 ${origin.origin} 需要与 iPad 在同一可互通网络；首次连接时允许本地网络访问。
“预览界面”是单独的虚构数据体验入口。账号密码、会话、服务端密钥都未写入工程。
设置页、账号与安全、权限、隐私、关于和问题反馈已更新；账号管理网页需要另行登录。
在线反馈与留言尚无接收接口；反馈支持整理文字、选择图片后由你主动分享，不显示已提交。

本版延续已运行的原生入口与项目配置，只增加开发网络 plist 和编译标记。原生 manifest 缓存由 Playgrounds 重新生成。
Windows 已做静态与导出检查；本版编译、登录和页面效果请在 iPad 上确认。旧 V5 和原始模板保留。
`, "utf8");
  for (const [file, hash] of originalHashes) assert.equal(digest(readFileSync(path.join(template, file))), hash, `Original template changed: ${file}`);
  const report = {
    packageName: path.basename(template),
    nativeEntryPreserved: digest(readFileSync(path.join(packageDirectory, "MyApp.swift"))) === originalHashes.get("MyApp.swift"),
    manifestChanges: ["additionalInfoPlistContentFilePath", "exclude generated plist", "DEBUG for local HTTP"],
    originalManifestHash: originalHashes.get("Package.swift"),
    generatedManifestHash: digest(adapted),
    sourceFiles: sources.map(([file]) => file), bilingualKeys: Object.keys(zh).length,
    defaultMode: "real sign-in; demo only by explicit selection", appleBuild: "pending on Apple device",
  };
  writeFileSync(path.join(output, "export-check.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  return { packageDirectory, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
    if (index % 2 === 0) pairs.push([arg, all[index + 1]]);
    return pairs;
  }, []));
  assert(args["--template"] && args["--output"], "Use --template native.swiftpm --output new-folder and MATHIN_API_ORIGIN");
  const result = exportPlayground({ template: args["--template"], output: args["--output"], apiOrigin: process.env.MATHIN_API_ORIGIN });
  console.log(JSON.stringify(result.report, null, 2));
}
