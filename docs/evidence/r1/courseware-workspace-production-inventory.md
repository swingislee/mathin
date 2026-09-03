# DEV-CW-1 Step 8D · 生产课件工作区只读 inventory

## 结论

- `gate_id`: `DEV-CW-1-STEP-8D`
- `domain`: `courseware-workspace-production-inventory`
- `result`: `production_inventory_captured; target_schema_not_ready`
- `measured_value`: `77,224 pages / 77,060 formally editable pages / 154,120 insertable track heads / 559,865 bindings / 3,770 releases / 4 frozen sessions`
- `threshold`: `read-only snapshot completes; unknown document versions = 0; existing page/binding/Storage/release/frozen-session rewrites = 0`
- `commit_sha`: `71b008dd7f53114571cd73cb9efb5377f04274cc`
- `migration_head`: `20260830000700_teacher_microcourse_editor_unification`
- `environment`: `production · SSH xiaomi · PostgreSQL fingerprint 10e3f97e…1a0c`
- `dataset_manifest`: `mathin-courseware-workspace-rollout-v1 aggregate snapshot; no row identifiers or PII captured`
- `started_at`: `2026-09-03T08:53:00Z`
- `finished_at`: `2026-09-03T08:56:45Z`
- `actor`: `Codex, using the repository read-only rollout auditor`
- `approver`: `product owner; explicit authorization “Step 8C 通过，允许生产只读盘点” on 2026-09-03`
- `command_or_runbook`: `pnpm cw:workspace-rollout:audit -- --ssh-target xiaomi --application-commit 71b008dd --compact`; `BatchMode` SSH; one `REPEATABLE READ READ ONLY` transaction with explicit rollback
- `artifact_url_or_path`: `this repository evidence summary`
- `artifact_hash`: `not_applicable; inline Git evidence is bound by its commit`
- `retention`: `through v1.0.0 plus 365 days`
- `access_roles`: `repository readers`
- `failure_ticket`: `blocked by missing target migrations 20260902000900 and 20260903000700, their required database functions, and separate production deployment approval`

## Target preflight

The invoking host was `WHITEHOUSE`; `.env.local` still pointed to the loopback development origin `http://127.0.0.1:35421`, and local port 3130 had a listener. `ssh -G xiaomi` resolved to `192.168.5.183`; the remote host reported `xiaomi`. The database fingerprint matched the registered production fingerprint. No secret, account identifier, page identifier, or course title was printed or retained.

## Inventory interpretation

The production snapshot contains 5,508 Aixuexi `source-runtime-page-v1` pages, 71,552 PageDoc pages, and 164 teacher-microcourse composition pages. PageDoc and source-runtime account for all 77,060 formally editable pages and all 154,120 insertable track heads. Composition remains on its separately deployed adapter. No unknown or legacy document version was present.

The candidate migrations are additive and operate on demand. The rollout plan requires no rewrite of existing page rows or asset bindings, no Storage pre-upload, no release-head advance, and no frozen-session mutation. Production does not yet contain either candidate migration or the required insertion/draft validation functions, so this evidence supports inventory compatibility only. It does not authorize migration, application publication, Storage mutation, release advancement, or business writes.
