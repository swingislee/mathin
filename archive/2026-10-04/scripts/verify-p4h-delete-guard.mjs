import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const protectedTables = ["class_sessions", "classrooms", "courses", "course_lectures"];
const protectedTablePattern = protectedTables.join("|");
const directDeletePattern = new RegExp(
  String.raw`\.from\(\s*["'](${protectedTablePattern})["']\s*\)[\s\S]{0,800}?\.delete\s*\(`,
  "g",
);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

const violations = walk(sourceRoot).flatMap((file) => {
  const content = fs.readFileSync(file, "utf8");
  return [...content.matchAll(directDeletePattern)].map((match) => ({
    file: path.relative(root, file),
    table: match[1],
  }));
});

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`P4H delete guard violation: ${violation.file} directly deletes ${violation.table}`);
  }
  process.exit(1);
}

console.log("P4H delete guard passed: no protected business table is physically deleted from src/");
