import fs from "node:fs";
import path from "node:path";

// P4I-1 §6：家庭可见数据边界——员工首页（含其直接子组件）不得引用家庭/学生白名单
// RPC 层，家庭/学生首页不得引用 staff 权限或数据层。静态 import 检查，不需要起服务。

const root = process.cwd();

const rules = [
  {
    label: "StaffHome must not import the family/student whitelist RPC layer",
    files: [
      path.join(root, "src/features/school/home/StaffHome.tsx"),
      path.join(root, "src/features/school/home/shared.tsx"),
    ],
    forbidden: [/from\s+["']@\/features\/school\/customer["']/],
  },
  {
    label: "ParentHome/StudentHome must not import staff perms or staff-only data layer",
    files: [
      path.join(root, "src/features/school/home/ParentHome.tsx"),
      path.join(root, "src/features/school/home/StudentHome.tsx"),
    ],
    forbidden: [
      /getMyPerms/,
      /from\s+["']@\/features\/school\/dashboard["']/,
    ],
  },
];

const violations = [];

for (const rule of rules) {
  for (const file of rule.files) {
    if (!fs.existsSync(file)) {
      violations.push({ file: path.relative(root, file), reason: "file not found" });
      continue;
    }
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of rule.forbidden) {
      if (pattern.test(content)) {
        violations.push({ file: path.relative(root, file), reason: `matches forbidden pattern ${pattern}`, rule: rule.label });
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`P4I-1 environment boundary violation: ${violation.file} — ${violation.reason}`);
  }
  process.exit(1);
}

console.log("P4I-1 environment boundary passed: staff/family/student home components stay on opposite sides of the data whitelist");
