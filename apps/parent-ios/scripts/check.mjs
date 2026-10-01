import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");
const walk = (directory) => readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const name = path.posix.join(directory, entry.name);
  return entry.isDirectory() ? walk(name) : [name];
});
const project = read("MathinParent.xcodeproj/project.pbxproj");
const objects = [...project.matchAll(/^\s*([A-F0-9]{24}) = \{\s*isa = /gm)].map((match) => match[1]);
assert.equal(objects.length, new Set(objects).size, "Xcode object IDs must be unique");
for (const id of project.match(/\b[A-F0-9]{24}\b/g) ?? []) assert(objects.includes(id), `Missing Xcode object ${id}`);
const sourcePhase = project.match(/isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([^)]*)\)/)?.[1] ?? "";
const swift = walk("MathinParent").filter((name) => name.endsWith(".swift"));
for (const name of swift) {
  const relative = name.replace("MathinParent/", "");
  const reference = [...project.matchAll(/([A-F0-9]{24}) = \{isa = PBXFileReference;[^\n]+/g)]
    .find((match) => match[0].includes(`path = "${relative}";`) || match[0].includes(`path = ${relative};`));
  assert(reference, `Xcode must reference ${relative}`);
  const build = project.match(new RegExp(`([A-F0-9]{24}) = \\{isa = PBXBuildFile; fileRef = ${reference[1]};`));
  assert(build && sourcePhase.includes(build[1]), `Xcode Sources must compile ${relative}`);
}

const strings = (locale) => {
  const source = read(`MathinParent/${locale}.lproj/Parent.strings`);
  assert(!source.startsWith("\uFEFF"), "Use UTF-8 without BOM");
  const pairs = [...source.matchAll(/^("(?:[^"\\]|\\.)*") = ("(?:[^"\\]|\\.)*");$/gm)]
    .map(([, key, value]) => [JSON.parse(key), JSON.parse(value)]);
  assert.equal(pairs.length, new Set(pairs.map(([key]) => key)).size, "Translation keys must be unique");
  assert(pairs.every(([, value]) => value.length > 0), "Translations must not be empty");
  return Object.fromEntries(pairs);
};
const zh = strings("zh-Hans"), en = strings("en");
assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "Chinese and English keys must match");
for (const file of swift) {
  const source = read(file);
  const keys = [...source.matchAll(/tr\("([a-z_]+)"\)/g), ...source.matchAll(/(?:title|detail|key|kind): "([a-z_]+)"/g)].map((match) => match[1]);
  for (const key of keys.filter((key) => !key.endsWith("_"))) assert(key in zh, `Missing translation ${key} in ${file}`);
}
for (const key of ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "all", "pending", "submitted", "feedback", "assessment", "exit_preview", "logout", "teacher_observation", "strengths", "focus_areas", "home_suggestion", "view_submission", "go_practice", "empty_detail"])
  assert(key in zh, `Missing dynamic translation ${key}`);
for (const kind of ["calls", "levels", "mistakes", "reading", "checkins", "feedback", "mailbox", "address", "invite", "reschedule", "transfer", "shipping"])
  assert(`availability_${kind}` in zh, `Missing service state ${kind}`);
for (const locale of ["zh-Hans", "en"]) {
  assert(project.includes(`${locale}.lproj/Parent.strings`), `Missing ${locale} resource`);
  assert(project.includes(`${locale}.lproj/InfoPlist.strings`), `Missing ${locale} permission resource`);
  assert(read(`MathinParent/${locale}.lproj/InfoPlist.strings`).includes('"NSLocalNetworkUsageDescription"'), `Missing ${locale} network permission text`);
}
assert(project.includes("name = Parent.strings;"), "Localized resource group must be in project");
assert(read("MathinParent/Info.plist").includes("$(MATHIN_API_ORIGIN)"), "API origin must use build configuration");
assert(!read("MathinParent/Info.plist").includes("NSAllowsArbitraryLoads"), "Keep scoped transport exceptions");
assert(!read("MathinParent/Info.plist").includes("NSAppTransportSecurity"), "Release must retain default transport security");
assert(read("MathinParent/Info-Debug.plist").includes("$(MATHIN_DEV_HTTP_HOST)"), "Debug IP exception must use local configuration");
assert(!read("MathinParent/Info-Debug.plist").includes("NSAllowsArbitraryLoads"), "Debug exception must remain scoped");
assert(read("Config/Debug.xcconfig").includes("INFOPLIST_FILE = MathinParent/Info-Debug.plist"));
assert(read("Config/Release.xcconfig").includes("INFOPLIST_FILE = MathinParent/Info.plist"));
assert(!project.includes("INFOPLIST_FILE ="), "Target settings must not override per-configuration plist selection");
assert(existsSync(path.join(root, "Package.swift")) && existsSync(path.join(root, "Tests/ParentCoreTests.swift")));
console.log(`iOS static check passed: ${swift.length} Swift source references, ${Object.keys(zh).length} bilingual strings, project resources and API configuration. Xcode compilation is a separate check.`);
