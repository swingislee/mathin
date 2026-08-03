-- P6-9：爱学习 2026 G+ 苏教版数学秋季课程接入。
--
-- 爱学习页面保留独立的 aixuexi-page-doc-v1 运行时契约；课程目录、CAS、
-- revision/release、16:9/4:3 轨道与课次冻结继续复用 Mathin P6 数据层。

alter table public.cw_page_revisions
  drop constraint if exists cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in ('page-doc-v1', 'aixuexi-page-doc-v1')
    and octet_length(doc::text) <= 1048576
  );

create table public.cw_source_packages (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (length(trim(source_system)) between 1 and 80),
  package_key text not null check (length(trim(package_key)) between 1 and 160),
  document_adapter text not null check (document_adapter in ('aixuexi-page-v1')),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  labels jsonb not null default '{}'::jsonb check (jsonb_typeof(labels) = 'object'),
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  status text not null default 'registered' check (status in ('registered','importing','imported','failed')),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, package_key)
);

create trigger cw_source_packages_set_updated_at
  before update on public.cw_source_packages
  for each row execute function public.set_updated_at();

create table public.cw_source_lectures (
  id uuid primary key default gen_random_uuid(),
  source_package_id uuid not null references public.cw_source_packages(id) on delete restrict,
  lecture_id uuid not null references public.course_lectures(id) on delete restrict,
  source_product_code text not null check (length(trim(source_product_code)) between 1 and 160),
  source_courseware_id text not null check (length(trim(source_courseware_id)) between 1 and 160),
  source_lesson_index smallint not null check (source_lesson_index > 0),
  offline_status text not null default 'complete' check (offline_status in ('complete','incomplete','failed')),
  page_count int not null check (page_count > 0),
  verification_sha256 text check (verification_sha256 is null or verification_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (source_package_id, source_courseware_id),
  unique (lecture_id)
);

create index cw_source_lectures_package_idx on public.cw_source_lectures(source_package_id);

alter table public.cw_source_packages enable row level security;
alter table public.cw_source_lectures enable row level security;

create policy "cw_source_packages_select_staff" on public.cw_source_packages
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_source_lectures_select_staff" on public.cw_source_lectures
  for select to authenticated using (public.is_staff((select auth.uid())));

revoke all on public.cw_source_packages, public.cw_source_lectures from anon, authenticated;
grant select on public.cw_source_packages, public.cw_source_lectures to authenticated;

-- 修复双轨 binding 之后课堂 RPC 未按 release.track 限定 binding 的问题；
-- 同一 binding_key 在两轨各有一行时，旧实现会聚合出重复资源。
create or replace function public.get_session_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no int, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  session_lecture_id uuid;
  release_id uuid;
  release_track text;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select s.courseware_resolved, s.lecture_id into resolved, session_lecture_id
    from public.class_sessions s where s.id = p_session_id and s.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null
     and resolved ->> 'version' = 'cw-session-resolved-v1'
     and (resolved ->> 'releaseId') ~ '^[0-9a-f-]{36}$' then
    release_id := (resolved ->> 'releaseId')::uuid;
  elsif session_lecture_id is not null then
    select l.current_release_id into release_id from public.course_lectures l where l.id = session_lecture_id;
  end if;
  if release_id is null then return; end if;

  select r.track, r.snapshot into release_track, release_snapshot
    from public.cw_lecture_releases r where r.id = release_id;
  if release_snapshot is null then return; end if;

  return query
  select p.id, p.page_no, rev.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'bindingKey', b ->> 'bindingKey',
                    'objectHash', o.sha256,
                    'kind', o.kind,
                    'launchQuery', pb.launch_query))
             from jsonb_array_elements(entry.value -> 'bindings') as b
             join public.cw_asset_revisions ar on ar.id = (b ->> 'assetRevisionId')::uuid
             join public.cw_asset_objects o on o.id = ar.object_id
             left join public.cw_page_asset_bindings pb
                    on pb.page_doc_id = p.id
                   and pb.binding_key = b ->> 'bindingKey'
                   and pb.track = release_track
         ), '[]'::jsonb)
    from jsonb_array_elements(release_snapshot) as entry
    join public.cw_page_docs p on p.id = (entry.value ->> 'pageDocId')::uuid
    join public.cw_page_revisions rev on rev.id = (entry.value ->> 'revisionId')::uuid
   order by p.page_no;
end;
$$;

-- 当前离线包只包含 3～6 年级秋季 G+；第 7、15 讲在源目录中缺失，保留编号缺口。
insert into public.course_families
  (slug, title, publisher, stage, subject, edition, description, purpose, status)
values
  ('aixuexi-gplus-primary-math-sujiao', '爱学习小学数学 · G+', '爱学习', '小学', '数学', '苏教版',
   '爱学习 G+ 课程体系。首批仅接入 2026 秋季三至六年级；其他年级、季节与难度后续扩展。',
   'production', 'enabled')
on conflict (slug) do update set
  title = excluded.title,
  publisher = excluded.publisher,
  stage = excluded.stage,
  subject = excluded.subject,
  edition = excluded.edition,
  description = excluded.description,
  purpose = excluded.purpose,
  status = excluded.status;

insert into public.courses (family_id, title, product_code, grade, term, class_type, status)
select family.id, variant.title, variant.product_code, variant.grade, 2, 'G+', 'enabled'
  from public.course_families family
  cross join (values
    (3::smallint, '爱学习 G+ 苏教版数学 · 三年级秋季', 'AXX26G-SJ-03-AUT'),
    (4::smallint, '爱学习 G+ 苏教版数学 · 四年级秋季', 'AXX26G-SJ-04-AUT'),
    (5::smallint, '爱学习 G+ 苏教版数学 · 五年级秋季', 'AXX26G-SJ-05-AUT'),
    (6::smallint, '爱学习 G+ 苏教版数学 · 六年级秋季', 'AXX26G-SJ-06-AUT')
  ) as variant(grade, title, product_code)
 where family.slug = 'aixuexi-gplus-primary-math-sujiao'
on conflict (product_code) do update set
  family_id = excluded.family_id,
  title = excluded.title,
  grade = excluded.grade,
  term = excluded.term,
  class_type = excluded.class_type,
  status = excluded.status;

with lecture_seed(grade, no, name) as (values
  (3,1,'混合运算'),(3,2,'混合运算新题型'),(3,3,'买票问题'),(3,4,'多位数乘一位数'),
  (3,5,'补窟窿'),(3,6,'重叠问题'),(3,8,'除法中的新题型'),(3,9,'看我拆拆拆'),
  (3,10,'观察物体'),(3,11,'长短不一'),(3,12,'稻草人做操'),(3,13,'人人有份'),(3,14,'缺一不可'),
  (4,1,'解决问题'),(4,2,'除法新题型'),(4,3,'巧求周长'),(4,4,'面积进阶'),
  (4,5,'巧算面积'),(4,6,'数量关系进阶'),(4,8,'算式大变身'),(4,9,'乘法新题型'),
  (4,10,'跑马圈地'),(4,11,'虫蚀算'),(4,12,'回到最开始的我'),(4,13,'除法计算应用'),(4,14,'铁树开花'),
  (5,1,'图形还能这样数'),(5,2,'父与子的面积'),(5,3,'鲨鱼的牙齿'),(5,4,'我们一样高'),
  (5,5,'可能性'),(5,6,'转角遇见谁'),(5,8,'公因数与公倍数'),(5,9,'公因数与公倍数的应用'),
  (5,10,'用字母表示复杂关系'),(5,11,'一起增来一起减'),(5,12,'割补法巧求面积'),(5,13,'移步换形'),(5,14,'比翼双飞'),
  (6,1,'数与运算新题型'),(6,2,'分数应用题综合'),(6,3,'二人同心'),(6,4,'比的应用（上）'),
  (6,5,'比的应用（下）'),(6,6,'圆的面积进阶'),(6,8,'圆新题型'),(6,9,'圆的综合'),
  (6,10,'浓淡相宜'),(6,11,'如何成为百万富翁'),(6,12,'取之于民，用之于民'),(6,13,'愤怒的小鸟'),(6,14,'平行世界')
)
insert into public.course_lectures(course_id, no, name)
select course.id, seed.no, seed.name
  from lecture_seed seed
  join public.courses course
    on course.grade = seed.grade and course.term = 2 and course.class_type = 'G+'
  join public.course_families family
    on family.id = course.family_id and family.slug = 'aixuexi-gplus-primary-math-sujiao'
on conflict (course_id, no) do update set name = excluded.name;

do $$
begin
  if (select count(*) from public.courses course join public.course_families family on family.id=course.family_id
       where family.slug='aixuexi-gplus-primary-math-sujiao') <> 4 then
    raise exception 'AIXUEXI_VARIANT_COUNT_MISMATCH';
  end if;
  if (select count(*) from public.course_lectures lecture join public.courses course on course.id=lecture.course_id
       join public.course_families family on family.id=course.family_id
       where family.slug='aixuexi-gplus-primary-math-sujiao') <> 52 then
    raise exception 'AIXUEXI_LECTURE_COUNT_MISMATCH';
  end if;
end;
$$;
