import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("teacher-microcourse:db-audit", [
  "teacher_microcourse_variants_assertions.sql",
]);
