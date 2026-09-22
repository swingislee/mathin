import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));

const configPath = path.join(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined, "网页 TypeScript 配置应能读取");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.equal(parsed.errors.length, 0, "网页 TypeScript 配置应能解析");
assert(!parsed.fileNames.some((file) => path.relative(root, path.resolve(file)).split(path.sep)[0] === "apps"),
  "原生目录应由各自的工具链检查");
const eslint = read("eslint.config.mjs");
assert(eslint.includes('"apps/**"'), "网页 ESLint 应隔离原生工程");
assert(read("src/app/globals.css").includes('@source not "../../apps";'),
  "网页 Tailwind 扫描应隔离原生工程");

const wechatRoot = "apps/parent-wechat/miniprogram/";
const app = json(wechatRoot + "app.json");
assert.equal(app.pages.length, 4);
assert.deepEqual(app.tabBar.list.map((item) => item.pagePath), app.pages);
for (const page of app.pages) {
  for (const extension of [".ts", ".json", ".wxml"]) {
    assert(existsSync(path.join(root, wechatRoot, page + extension)), page + extension);
  }
}
const project = json("apps/parent-wechat/project.config.json");
assert.equal(project.appid, "touristappid", "真实 AppID 应保留在已忽略的 project.private.config.json");
assert.equal(project.miniprogramRoot, "miniprogram/");
assert(project.setting.useCompilerPlugins.includes("typescript"));
assert.equal(project.setting.urlCheck, true);
const theme = json(wechatRoot + "theme.json");
assert.deepEqual(Object.keys(theme.light).sort(), Object.keys(theme.dark).sort());

const ios = read("apps/parent-ios/MathinParent.xcodeproj/project.pbxproj");
const ids = new Set([...ios.matchAll(/^\s*([A-F0-9]{24}) = \{/gm)].map((match) => match[1]));
for (const id of ios.match(/\b[A-F0-9]{24}\b/g) ?? []) {
  assert(ids.has(id), "Xcode 对象引用不存在：" + id);
}
for (const file of ["MathinParentApp.swift", "ParentRootView.swift", "ParentTheme.swift", "Info.plist"]) {
  assert(ios.includes(file));
  assert(existsSync(path.join(root, "apps/parent-ios/MathinParent", file)));
}
const iosKeys = (locale) => [...read("apps/parent-ios/MathinParent/" + locale + ".lproj/Localizable.strings")
  .matchAll(/^"([^"]+)"\s*=/gm)].map((match) => match[1]).sort();
assert.deepEqual(iosKeys("zh-Hans"), iosKeys("en"), "iOS 翻译键应一致");
const androidKeys = (folder) => [...read("apps/parent-android/app/src/main/res/" + folder + "/strings.xml")
  .matchAll(/<string name="([^"]+)">/g)].map((match) => match[1]).sort();
assert.deepEqual(androidKeys("values"), androidKeys("values-en"), "Android 翻译键应一致");
assert.deepEqual(iosKeys("en"), androidKeys("values").filter((key) => key !== "app_name"),
  "两端导航和外壳文案键应一致");

const wrapperMetadata = json("apps/parent-android/gradle/wrapper/checksums.json");
const wrapper = readFileSync(path.join(root, "apps/parent-android/gradle/wrapper/gradle-wrapper.jar"));
assert.equal(createHash("sha256").update(wrapper).digest("hex"), wrapperMetadata.wrapperSha256);
assert(read("apps/parent-android/gradle/wrapper/gradle-wrapper.properties")
  .includes("distributionSha256Sum=" + wrapperMetadata.distributionSha256));

const api = json("contracts/parent-api/openapi.json");
assert.equal(api.openapi, "3.1.0");
assert.equal(api.servers[0].url, "/");
for (const route of Object.keys(api.paths)) {
  assert(existsSync(path.join(root, "src/app", route.slice(1), "route.ts")),
    "OpenAPI 只登记已经实现的接口：" + route);
}
console.log("家长端工程配置、翻译键、Gradle 校验和、API 路径和网页扫描边界通过。");
