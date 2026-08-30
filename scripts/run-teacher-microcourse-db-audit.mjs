import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("teacher-microcourse:db-audit", [
  "teacher_microcourse_class_series_assertions.sql",
  "teacher_microcourse_lifecycle_assertions.sql",
  "teacher_microcourse_variants_assertions.sql",
  "teacher_microcourse_composition_upgrade_assertions.sql",
  "teacher_microcourse_browser_v2_assertions.sql",
]);
