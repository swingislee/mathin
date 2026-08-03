import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("p4e:db-audit", ["p4e_security_assertions.sql"]);
