-- 测试用：逐字段复现 toStudentDirectoryCard，对照数据库的窄卡片出口。
create function pg_temp.project_cards(p jsonb) returns jsonb language sql immutable as $project$
  select (p-'rows')||jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',v->'studentId','name',v->'name','grade',v->'grade','gradeText',v->'gradeText',
    'phoneTail',right(regexp_replace(v->>'phone','[^0-9]','','g'),4),
    'stage',v->'stage','detail',v->'detail','groups',v->'directoryGroups','canContact',v->'canWrite',
    'assessment',case when coalesce(v->>'assessmentSource','')<>'class_band'
      and (nullif(v->>'assessmentRecordId','') is not null or nullif(v->>'assessmentAt','') is not null or v->>'assessmentSource'='assessment')
      then jsonb_build_object('band',v->'assessmentBand','score',v->'score','at',v->'assessmentAt') else null end) order by i)
    from jsonb_array_elements(p->'rows') with ordinality t(v,i)),'[]'::jsonb));
$project$;
