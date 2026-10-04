import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("db:courseware-security", ["p6_courseware_security_assertions.sql"]);
