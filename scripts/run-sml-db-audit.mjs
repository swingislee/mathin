import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("sml:db-audit", [
  "sml0_courseware_lecture_capability_assertions.sql",
  "sml0_courseware_lifecycle_capability_assertions.sql",
]);
