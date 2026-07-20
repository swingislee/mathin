import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");

// P4H-11 §3.3：这 5 个文件必须继续是「权限检查 + permanentRedirect」的兼容壳。
const legacyShells = [
  "src/app/[locale]/dashboard/courses/[id]/page.tsx",
  "src/app/[locale]/dashboard/courses/[id]/lectures/[lectureId]/page.tsx",
  "src/app/[locale]/dashboard/courseware/[courseId]/page.tsx",
  "src/app/[locale]/dashboard/courseware/[courseId]/[lectureId]/page.tsx",
  "src/app/[locale]/dashboard/courseware/[courseId]/[lectureId]/[pageId]/page.tsx",
];

// 旧地址在源码里出现的字面量模式（模板字符串写法，排除上面 5 个壳文件自身）。
const deadLinkPatterns = [
  { name: "courses/[id]/lectures/[lectureId]", pattern: /\/dashboard\/courses\/\$\{[^}]+\}\/lectures\//g },
  { name: "courseware/[courseId]/[lectureId]/[pageId]", pattern: /\/dashboard\/courseware\/\$\{[^}]+\}\/\$\{[^}]+\}\/\$\{[^}]+\}/g },
  { name: "courseware/[courseId]/[lectureId]", pattern: /\/dashboard\/courseware\/\$\{[^}]+\}\/\$\{[^}]+\}(?!\/\$)/g },
  { name: "courseware/[courseId]", pattern: /\/dashboard\/courseware\/\$\{[^}]+\}(?!\/)/g },
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

const failures = [];

// 1. 五个 legacy shell 必须存在且仍是 permanentRedirect。
for (const relPath of legacyShells) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`legacy shell missing (should be kept at least one release cycle): ${relPath}`);
    continue;
  }
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes("permanentRedirect")) {
    failures.push(`legacy shell no longer redirects (regressed into a full page?): ${relPath}`);
  }
}

// 2. 仓库里不得有指向这 5 条旧地址的死链接（排除壳文件自身，它们内部构造的是重定向目标，不是死链接）。
const legacyShellFullPaths = new Set(legacyShells.map((p) => path.join(root, p)));
for (const file of walk(sourceRoot)) {
  if (legacyShellFullPaths.has(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  for (const { name, pattern } of deadLinkPatterns) {
    if (pattern.test(content)) {
      failures.push(`dead link to legacy route "${name}" found in ${path.relative(root, file)}`);
    }
  }
}

// 3. CoursewareTemplateEditor 必须已经从用户界面退出（P4H-11 §3.3），只能作为负向测试断言出现。
for (const file of walk(sourceRoot)) {
  const content = fs.readFileSync(file, "utf8");
  if (content.includes("CoursewareTemplateEditor")) {
    failures.push(`CoursewareTemplateEditor referenced again in ${path.relative(root, file)}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`P4H route audit violation: ${failure}`);
  process.exit(1);
}

console.log("P4H route audit passed: legacy shells still redirect, no dead links, CoursewareTemplateEditor stays retired.");
