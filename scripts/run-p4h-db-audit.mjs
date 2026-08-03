import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("p4h:db-audit", ["p4h_teaching_operations_assertions.sql"]);
