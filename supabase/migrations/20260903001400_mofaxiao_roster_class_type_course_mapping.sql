-- DATA-IMPORT-CLASS-ROSTER-5: keep the Mofaxiao business class type in the
-- generated class name while resolving its textbook variant independently.
-- In particular, E-series A+ classes use the B textbook without becoming B
-- classes. Existing v1 batches without courseClassType retain their behavior.

begin;

create or replace function mathin_internal.build_mofaxiao_roster_class_name(p_default jsonb)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_system text := regexp_replace(btrim(coalesce(p_default->>'system', '')), '\s+', '', 'g');
  v_grade text := regexp_replace(btrim(coalesce(p_default->>'gradeText', '')), '\s+', '', 'g');
  v_season text := regexp_replace(btrim(coalesce(p_default->>'seasonText', '')), '\s+', '', 'g');
  v_class_type text := regexp_replace(btrim(coalesce(
    p_default->>'businessClassType', p_default->>'classType', ''
  )), '\s+', '', 'g');
  v_campus text := regexp_replace(btrim(coalesce(p_default->>'campusName', '')), '\s+', '', 'g');
  v_teacher text := regexp_replace(btrim(coalesce(p_default->>'teacherInitials', '')), '\s+', '', 'g');
  v_weekday text := regexp_replace(btrim(coalesce(p_default->>'weekday', '')), '\s+', '', 'g');
  v_time text := regexp_replace(btrim(coalesce(p_default->>'time', '')), '\s+', '', 'g');
begin
  v_system := regexp_replace(v_system, '体系$', '');
  if v_system = '' then
    v_system := '待定系列';
  elsif public.normalize_mofaxiao_class_text(v_system) like '%贯通%' then
    v_system := '贯通思维';
  elsif public.normalize_mofaxiao_class_text(v_system) like '%培优%'
     or public.normalize_mofaxiao_class_text(v_system) like '%科学%' then
    v_system := '科学思维';
  end if;
  if v_grade = '' then v_grade := '待定年级'; end if;
  if v_season = '' then v_season := '待定季节'; end if;
  if v_class_type = '' then v_class_type := '待定班型'; end if;
  if public.normalize_mofaxiao_class_text(v_campus) like '%紫辰%' then v_campus := '紫辰阁'; end if;
  if v_campus = '' then v_campus := '待定校区'; end if;
  if v_teacher = '' then
    v_teacher := regexp_replace(btrim(coalesce(p_default->>'teacherName', '')), '\s+', '', 'g');
  end if;
  if v_teacher = '' then v_teacher := '待定老师'; end if;
  if v_weekday = '' then v_weekday := '待定星期'; end if;
  if v_time = '' then v_time := '待定时间'; end if;
  return left('【' || v_system || '】' || v_grade || v_season || v_class_type ||
    '｜' || v_campus || v_teacher || v_weekday || v_time, 100);
end
$$;

revoke all on function mathin_internal.build_mofaxiao_roster_class_name(jsonb)
  from public, anon, authenticated;

alter function public.apply_mofaxiao_class_roster_import(uuid)
  rename to apply_mofaxiao_class_roster_import_class_type_base;
alter function public.apply_mofaxiao_class_roster_import_class_type_base(uuid)
  set schema mathin_internal;
revoke all on function mathin_internal.apply_mofaxiao_class_roster_import_class_type_base(uuid)
  from public, anon, authenticated;

create or replace function public.apply_mofaxiao_class_roster_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
begin
  if v_uid is null or not public.has_perm(v_uid, 'enrollment.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_batch
    from public.data_import_batches
   where id = p_batch_id
   for update;
  if v_batch.id is null
     or v_batch.import_kind <> 'enrollments'
     or v_batch.template_version <> 'mofaxiao-class-roster-v1'
     or v_batch.source_system is distinct from 'mofaxiao' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if v_batch.status <> 'completed' then
    update public.data_import_rows item
       set payload = jsonb_set(
         jsonb_set(
           item.payload,
           '{defaultClass,businessClassType}',
           to_jsonb(item.payload #>> '{defaultClass,classType}'),
           true
         ),
         '{defaultClass,classType}',
         to_jsonb(coalesce(
           nullif(item.payload #>> '{defaultClass,courseClassType}', ''),
           item.payload #>> '{defaultClass,classType}'
         )),
         true
       )
     where item.batch_id = v_batch.id
       and item.row_status = 'valid'
       and jsonb_typeof(item.payload->'defaultClass') = 'object';
  end if;

  return mathin_internal.apply_mofaxiao_class_roster_import_class_type_base(v_batch.id);
end
$$;

comment on function public.apply_mofaxiao_class_roster_import(uuid) is
  'Applies a validated Mofaxiao roster batch while keeping business class type separate from textbook variant.';

revoke all on function public.apply_mofaxiao_class_roster_import(uuid)
  from public, anon, authenticated;
grant execute on function public.apply_mofaxiao_class_roster_import(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
