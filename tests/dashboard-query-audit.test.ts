import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("finds the same database reads when assessment helpers are imported with local aliases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-query-audit-"));
  try {
    const write = (file: string, text: string) => {
      const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
    };
    write("supabase/migrations/001.sql", "create table public.assessment_results(id uuid); create table public.activities(id uuid);");
    write("src/features/school/assessment-workbench-read.ts", "export const readRelatedAssessmentRows = () => []; export const assessmentReadFrom = () => () => ({});");
    for (const alias of [false, true]) {
      write(`src/app/[locale]/dashboard/${alias ? "alias" : "canonical"}/page.tsx`, `
        import { readRelatedAssessmentRows${alias ? " as readRelatedRows" : ""}, assessmentReadFrom${alias ? " as from" : ""} } from "@/features/school/assessment-workbench-read";
        const client = {};
        export default async function Page() {
          const rows = await ${alias ? "readRelatedRows" : "readRelatedAssessmentRows"}(client, "assessment_results", "id", "registration_id", []);
          const activities = await ${alias ? "from" : "assessmentReadFrom"}(client)("activities").select("id");
          return Array.from(rows);
        }
      `);
    }
    const output = path.join(root, "audit.json");
    execFileSync(process.execPath, [path.resolve("scripts/dashboard-query-audit.mjs"), output], { cwd: root, windowsHide: true, stdio: "pipe" });
    const report = JSON.parse(fs.readFileSync(output, "utf8")) as { queries: { file: string; resource: string; operation: string }[] };
    for (const page of ["alias", "canonical"]) {
      const found = report.queries.filter(query => query.file.includes(`/${page}/`));
      expect(found.map(query => [query.resource, query.operation])).toEqual([["assessment_results", "read"], ["activities", "read"]]);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
