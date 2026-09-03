import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("web-push:db-audit", ["web_push_assertions.sql"]);
