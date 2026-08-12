\set ON_ERROR_STOP on
-- SML-0：发布/紧急发布/回滚 capability 与课堂 freeze 独立边界。全程回滚。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset

\if :{?admin_id}
\else
  \echo SML-0 release fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo SML-0 release fixtures missing: 测试-教师
  select 1 / 0;
\endif

insert into public.courses(
  title, product_code, grade, term, class_type, status, created_by
) values (
  '__SML0_RELEASE__',
  '__SML0_RELEASE__' || replace(gen_random_uuid()::text, '-', ''),
  1,
  1,
  'audit',
  'enabled',
  :'admin_id'
)
returning id as course_id, family_id \gset

insert into public.course_lectures(course_id, no, name, status)
values (:'course_id', 1, '__SML0_RELEASE_LECTURE__', 'active')
returning id as lecture_id \gset

insert into public.cw_page_docs(
  lecture_id, page_no, title, source_courseware_id, source_page_id, adapt_class
) values (
  :'lecture_id', 1, '__SML0_RELEASE_PAGE__', 'sml0-release', 'page-1', 'A'
)
returning id as page_id \gset

insert into public.cw_page_revisions(
  page_doc_id, revision_no, doc, origin, track, created_by
) values (
  :'page_id',
  1,
  jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'sml0-release',
    'sourcePageId', 'page-1',
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('a', 64),
    'canvas', jsonb_build_object(
      'width', 1280,
      'height', 720,
      'backgroundColor', null,
      'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ),
  'import',
  'native-16x9',
  :'admin_id'
)
returning id as native_revision_id \gset

insert into public.cw_page_revisions(
  page_doc_id, revision_no, doc, origin, track, created_by
) values (
  :'page_id',
  2,
  jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'sml0-release',
    'sourcePageId', 'page-1',
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('a', 64),
    'canvas', jsonb_build_object(
      'width', 960,
      'height', 720,
      'backgroundColor', null,
      'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ),
  'adapt-4x3',
  'adapted-4x3',
  :'admin_id'
)
returning id as adapted_revision_id \gset

update public.cw_page_docs
set current_revision_id = :'native_revision_id', aspect = '16:9'
where id = :'page_id';

insert into public.cw_page_track_heads(page_doc_id, track, current_revision_id)
values
  (:'page_id', 'native-16x9', :'native_revision_id'),
  (:'page_id', 'adapted-4x3', :'adapted_revision_id')
on conflict(page_doc_id, track) do update
set current_revision_id = excluded.current_revision_id,
    draft_revision_id = null,
    updated_at = now();

do $$
declare failures text[] := '{}';
begin
  if not has_function_privilege('authenticated', 'public.publish_cw_track_release(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.rollback_cw_track_release(uuid,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.publish_cw_review_cycle(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.emergency_publish_cw_review(uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.rollback_cw_lecture_release(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.publish_cw_adapt_releases(uuid[],text)', 'EXECUTE') then
    failures := array_append(failures, 'public release wrapper execute grant missing');
  end if;
  if has_function_privilege('authenticated', 'public.publish_cw_track_release_pre_sml0_impl(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rollback_cw_track_release_pre_sml0_impl(uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.publish_cw_review_cycle_pre_sml0_impl(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.emergency_publish_cw_review_pre_sml0_impl(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rollback_cw_lecture_release_pre_sml0_impl(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.publish_cw_adapt_releases_pre_sml0_impl(uuid[],text)', 'EXECUTE') then
    failures := array_append(failures, 'internal release implementation execute grant leaked');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'SML0_RELEASE_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- 平台管理员没有课程责任时，不能直接发布。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml.release.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.publish_cw_track_release(
      current_setting('sml.release.lecture_id')::uuid,
      'adapted-4x3',
      'missing relation'
    );
    raise exception 'SML0_RELEASE_MISSING_RELATION_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RELATION_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

-- reviewer 是有效课程关系，但不能承担普通发布。
insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values (
  :'admin_id', 'variant', :'course_id', 'reviewer', :'admin_id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml.release.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.publish_cw_track_release(
      current_setting('sml.release.lecture_id')::uuid,
      'adapted-4x3',
      'reviewer only'
    );
    raise exception 'SML0_REVIEWER_PUBLISHED_RELEASE';
  exception when others then
    if sqlerrm <> 'RESPONSIBILITY_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

delete from public.course_staff_assignments
where user_id = :'admin_id' and course_id = :'course_id' and responsibility = 'reviewer';
insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values (
  :'admin_id', 'variant', :'course_id', 'editor', :'admin_id'
);

-- editor 可以直接发布，并且两种 rollback 签名都从旧快照创建向前 release。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.publish_cw_track_release(
  :'lecture_id', 'adapted-4x3', 'direct release'
) as direct_release_id \gset
select public.rollback_cw_track_release(
  :'lecture_id', 'adapted-4x3', :'direct_release_id', 'track rollback'
) as track_rollback_id \gset
select public.rollback_cw_lecture_release(
  :'lecture_id', :'direct_release_id', 'legacy rollback'
) as legacy_rollback_id \gset
select (
  (select track = 'adapted-4x3' and release_no = 2
   from public.cw_lecture_releases where id = :'track_rollback_id')
  and (select track = 'adapted-4x3' and release_no = 3
       from public.cw_lecture_releases where id = :'legacy_rollback_id')
  and (select current_release_id = :'legacy_rollback_id'::uuid
       from public.cw_lecture_track_heads
       where lecture_id = :'lecture_id' and track = 'adapted-4x3')
) as track_rollback_ok \gset
\if :track_rollback_ok
\else
  \echo SML-0 release failed: track rollback
  select 1 / 0;
\endif
select (
  select track = 'adapted-4x3'
  from public.cw_lecture_releases where id = :'legacy_rollback_id'
) as legacy_rollback_ok \gset
\if :legacy_rollback_ok
\else
  \echo SML-0 release failed: legacy rollback track resolution
  select 1 / 0;
\endif
reset role;

-- 批量入口先验证完整 selection；第二个讲次无责任时，第一讲也不会先发布。
insert into public.courses(
  title, product_code, grade, term, class_type, status, created_by
) values (
  '__SML0_RELEASE_FOREIGN__',
  '__SML0_RELEASE_FOREIGN__' || replace(gen_random_uuid()::text, '-', ''),
  1,
  1,
  'audit',
  'enabled',
  :'admin_id'
)
returning id as foreign_course_id \gset
insert into public.course_lectures(course_id, no, name, status)
values (:'foreign_course_id', 1, '__SML0_RELEASE_FOREIGN_LECTURE__', 'active')
returning id as foreign_lecture_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select revision_id as batch_draft_id, revision_no as batch_draft_no
from public.save_cw_track_page_draft(
  :'page_id',
  'adapted-4x3',
  (select doc from public.cw_page_revisions where id = :'adapted_revision_id'),
  2,
  'batch draft'
) \gset
select set_config('sml.release.lecture_id', :'lecture_id', true);
select set_config('sml.release.foreign_lecture_id', :'foreign_lecture_id', true);
do $$
begin
  begin
    perform * from public.publish_cw_adapt_releases(
      array[
        current_setting('sml.release.lecture_id')::uuid,
        current_setting('sml.release.foreign_lecture_id')::uuid
      ],
      'must preflight all'
    );
    raise exception 'SML0_BATCH_PARTIAL_CAPABILITY_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RELATION_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
select (
  select count(*) = 3
  from public.cw_lecture_releases
  where lecture_id = :'lecture_id' and track = 'adapted-4x3'
) as batch_preflight_atomic_ok \gset
\if :batch_preflight_atomic_ok
\else
  \echo SML-0 release failed: batch preflight published before full authorization
  select 1 / 0;
\endif
select release_id as batch_release_id
from public.publish_cw_adapt_releases(array[:'lecture_id'::uuid], 'authorized batch') \gset
select (
  :'batch_release_id'::uuid is not null
  and (select current_release_id = :'batch_release_id'::uuid
       from public.cw_lecture_track_heads
       where lecture_id = :'lecture_id' and track = 'adapted-4x3')
) as batch_release_ok \gset
\if :batch_release_ok
\else
  \echo SML-0 release failed: authorized batch
  select 1 / 0;
\endif
reset role;

-- 评审后发布仍要求 owner/editor；只有 reviewer 责任时 fail closed。
insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values (
  :'admin_id', 'variant', :'course_id', 'reviewer', :'admin_id'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select revision_id as review_draft_id, revision_no as review_draft_no
from public.save_cw_track_page_draft(
  :'page_id',
  'adapted-4x3',
  (select doc from public.cw_page_revisions where id = :'batch_draft_id'),
  :'batch_draft_no',
  'review draft'
) \gset
select public.submit_cw_review(
  :'lecture_id', 'adapted-4x3', 'submit for release'
) as review_cycle_id \gset
select public.approve_cw_review(:'review_cycle_id', 'approved', null);
reset role;

delete from public.course_staff_assignments
where user_id = :'admin_id' and course_id = :'course_id' and responsibility = 'editor';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml.release.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.publish_cw_review_cycle(
      current_setting('sml.release.lecture_id')::uuid,
      'adapted-4x3',
      'reviewer cannot publish'
    );
    raise exception 'SML0_REVIEW_PUBLISH_WITHOUT_EDITOR_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RESPONSIBILITY_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values (
  :'admin_id', 'variant', :'course_id', 'editor', :'admin_id'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.publish_cw_review_cycle(
  :'lecture_id', 'adapted-4x3', 'review release'
) as review_release_id \gset
select (
  (select published_release_id = :'review_release_id'::uuid
   from public.cw_review_cycles where id = :'review_cycle_id')
  and (select current_release_id = :'review_release_id'::uuid
       from public.cw_lecture_track_heads
       where lecture_id = :'lecture_id' and track = 'adapted-4x3')
) as review_release_ok \gset
\if :review_release_ok
\else
  \echo SML-0 release failed: review release
  select 1 / 0;
\endif

-- editor 不能紧急发布；effective owner 可以，并留下 bypass audit cycle。
select revision_id as emergency_draft_id, revision_no as emergency_draft_no
from public.save_cw_track_page_draft(
  :'page_id',
  'adapted-4x3',
  (select doc from public.cw_page_revisions where id = :'review_draft_id'),
  :'review_draft_no',
  'emergency draft'
) \gset
select set_config('sml.release.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.emergency_publish_cw_review(
      current_setting('sml.release.lecture_id')::uuid,
      'adapted-4x3',
      'urgent correction',
      'editor only'
    );
    raise exception 'SML0_EDITOR_EMERGENCY_PUBLISHED';
  exception when others then
    if sqlerrm <> 'RESPONSIBILITY_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values (
  :'admin_id', 'variant', :'course_id', 'owner', :'admin_id'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.emergency_publish_cw_review(
  :'lecture_id',
  'adapted-4x3',
  'urgent correction',
  'owner emergency release'
) as emergency_release_id \gset
select (
  (select current_release_id = :'emergency_release_id'::uuid
   from public.cw_lecture_track_heads
   where lecture_id = :'lecture_id' and track = 'adapted-4x3')
  and exists (
    select 1 from public.cw_review_cycles
    where lecture_id = :'lecture_id'
      and track = 'adapted-4x3'
      and review_round_no = 0
      and status = 'bypassed'
      and published_release_id = :'emergency_release_id'
  )
) as emergency_release_ok \gset
\if :emergency_release_ok
\else
  \echo SML-0 release failed: emergency owner release
  select 1 / 0;
\endif
reset role;

-- freeze 使用课堂教师关系；没有 course_staff_assignment 的任课教师仍可冻结精确 release。
insert into public.classrooms(
  owner_id, name, invite_code, course_id, courseware_track
) values (
  :'teacher_id',
  '__SML0_RELEASE_CLASS__',
  substr(md5(gen_random_uuid()::text), 1, 8),
  :'course_id',
  'adapted-4x3'
)
returning id as classroom_id \gset
insert into public.classroom_members(classroom_id, user_id, role)
values (:'classroom_id', :'teacher_id', 'teacher')
on conflict do nothing;
insert into public.class_sessions(classroom_id, lecture_id, title)
values (:'classroom_id', :'lecture_id', '__SML0_RELEASE_SESSION__')
returning id as session_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.freeze_session_courseware(
  :'session_id',
  (select courseware_pages from public.cw_lecture_releases where id = :'emergency_release_id'),
  jsonb_build_object(
    'version', 'cw-session-resolved-v1',
    'track', 'adapted-4x3',
    'releaseId', :'emergency_release_id',
    'bindings', '[]'::jsonb
  )
);
reset role;

select (
  (select courseware_frozen_at is not null
   from public.class_sessions where id = :'session_id')
  and not exists (
    select 1 from public.course_staff_assignments
    where user_id = :'teacher_id'
      and (
        course_id = :'course_id'::uuid
        or lecture_id = :'lecture_id'::uuid
        or family_id = :'family_id'::uuid
      )
  )
) as session_teacher_freeze_ok \gset
\if :session_teacher_freeze_ok
\else
  \echo SML-0 release failed: session teacher freeze boundary
  select 1 / 0;
\endif

rollback;
\echo SML-0 courseware release capability assertions passed
