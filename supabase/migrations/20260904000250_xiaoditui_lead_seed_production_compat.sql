-- The original Xiaoditui intake migration predates the class and enrollment
-- import kinds. Restore the full import-kind contract after applying it so an
-- out-of-order production rollout does not regress later import workflows.

alter table public.data_import_batches
  drop constraint if exists data_import_batches_import_kind_check;

alter table public.data_import_batches
  add constraint data_import_batches_import_kind_check
  check (import_kind in ('students', 'staff', 'leads', 'classes', 'enrollments'));
