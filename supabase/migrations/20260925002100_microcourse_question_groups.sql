-- 目录分组独立于冻结内容；调整时同时使用既有页面重排合同。
create table public.teacher_microcourse_question_groups (
  microcourse_id uuid primary key references public.teacher_microcourses(id) on delete restrict,
  groups jsonb not null default '[]',
  version integer not null check(version>0),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);
alter table public.teacher_microcourse_question_groups enable row level security;
create policy teacher_microcourse_question_groups_read on public.teacher_microcourse_question_groups for select to authenticated
  using(public.can_read_teacher_microcourse_draft(microcourse_id,auth.uid()));
revoke all on public.teacher_microcourse_question_groups from anon,authenticated;
grant select on public.teacher_microcourse_question_groups to authenticated;

create function public.get_teacher_microcourse_question_groups(p_microcourse_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare state public.teacher_microcourse_question_groups%rowtype; cleaned jsonb;
begin
  if not public.can_read_teacher_microcourse_draft(p_microcourse_id,auth.uid()) or auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  select * into state from public.teacher_microcourse_question_groups where microcourse_id=p_microcourse_id;
  select coalesce(jsonb_agg(g||jsonb_build_object('questionIds',coalesce((select jsonb_agg(p.id order by p.n) from jsonb_array_elements(g->'questionIds') with ordinality p(id,n)
    where exists(select 1 from public.cw_page_docs d join public.teacher_microcourses m on m.lecture_id=d.lecture_id where m.id=p_microcourse_id and d.id=(p.id#>>'{}')::uuid and d.deleted_at is null)),'[]'::jsonb)) order by ord),'[]'::jsonb)
    into cleaned from jsonb_array_elements(coalesce(state.groups,'[]')) with ordinality t(g,ord);
  return jsonb_build_object('version',coalesce(state.version,0),'groups',cleaned);
end $$;
create function public.save_teacher_microcourse_question_groups(p_microcourse_id uuid,p_version integer,p_groups jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare lecture_value uuid; current_version integer; group_item jsonb; ids uuid[]; ungrouped uuid[];
begin
  lecture_value:=public.assert_teacher_microcourse_author(p_microcourse_id);
  perform 1 from public.course_lectures where id=lecture_value for update;
  select version into current_version from public.teacher_microcourse_question_groups where microcourse_id=p_microcourse_id for update;
  if coalesce(current_version,0) is distinct from p_version then raise exception 'CONFLICT'; end if;
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)>60 or octet_length(p_groups::text)>100000 then raise exception 'VALIDATION'; end if;
  for group_item in select value from jsonb_array_elements(p_groups) loop
    if (group_item->>'id')::uuid is null or jsonb_typeof(group_item->'name') is distinct from 'string' or length(btrim(group_item->>'name')) not between 1 and 60
      or jsonb_typeof(group_item->'questionIds') is distinct from 'array' or jsonb_array_length(group_item->'questionIds')>200 then raise exception 'VALIDATION'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_groups) g group by g->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_groups) g group by btrim(g->>'name') having count(*)>1) then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg((p.id#>>'{}')::uuid order by g.ord,p.ord),'{}') into ids
    from jsonb_array_elements(p_groups) with ordinality g(item,ord),jsonb_array_elements(g.item->'questionIds') with ordinality p(id,ord);
  if cardinality(ids)<>cardinality(array(select distinct unnest(ids))) or exists(select 1 from unnest(ids) q(question_id) where not exists(select 1 from public.cw_page_docs d where d.id=q.question_id and d.lecture_id=lecture_value and d.deleted_at is null)) then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(id order by page_no),'{}') into ungrouped from public.cw_page_docs where lecture_id=lecture_value and deleted_at is null and not(id=any(ids));
  if cardinality(ids||ungrouped)>0 then perform public.reorder_teacher_microcourse_pages(p_microcourse_id,ids||ungrouped); end if;
  insert into public.teacher_microcourse_question_groups(microcourse_id,groups,version,updated_by) values(p_microcourse_id,p_groups,coalesce(current_version,0)+1,auth.uid())
    on conflict(microcourse_id) do update set groups=excluded.groups,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
  return public.get_teacher_microcourse_question_groups(p_microcourse_id);
end $$;
revoke all on function public.get_teacher_microcourse_question_groups(uuid),public.save_teacher_microcourse_question_groups(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.get_teacher_microcourse_question_groups(uuid),public.save_teacher_microcourse_question_groups(uuid,integer,jsonb) to authenticated;
