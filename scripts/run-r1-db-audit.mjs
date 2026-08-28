import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

runAssertionFiles("r1:db-audit", [
  "dev_org_location_v2_assertions.sql",
  "dev_org_academic_calendar_v2_assertions.sql",
  "r1_organization_settings_assertions.sql",
  "r1_notebook_assertions.sql",
  "r1_platform_runtime_assertions.sql",
  "r1_account_security_assertions.sql",
  "r1_family_portal_assertions.sql",
  "r1_learning_results_assertions.sql",
  "r1_data_governance_assertions.sql",
  "r1_data_quality_assertions.sql",
  "r1_data_repair_assertions.sql",
  "r1_export_artifacts_assertions.sql",
  "doc26_teacher_workflow_assertions.sql",
  "r1_work_items_assertions.sql",
  "r1_finance_close_assertions.sql",
  "r1_live_object_protection_assertions.sql",
  "r1_live_school_year_assertions.sql",
]);
