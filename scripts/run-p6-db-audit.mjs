import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("p6:db-audit", [
  "p6_courseware_security_assertions.sql",
  "p6_courseware_studio_assertions.sql",
  "p6_courseware_replacement_assertions.sql",
  "p6_courseware_tracks_assertions.sql",
  "p6_adapt_rework_assertions.sql",
]);
