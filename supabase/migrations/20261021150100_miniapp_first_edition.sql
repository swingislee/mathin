-- App presentation is an optional addition; existing publications retain their appearance.
create or replace function mathin_internal.valid_miniapp_runtime_spec(p jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(jsonb_typeof(p)='object' and p->'version'='1'::jsonb
    and jsonb_typeof(p->'tabs')='array' and jsonb_array_length(p->'tabs') between 2 and 5
    and jsonb_typeof(p->'screens')='array' and jsonb_array_length(p->'screens') between 1 and 60
    and not exists(select 1 from jsonb_object_keys(p) k where k not in ('version','tabs','screens','presentation'))
    and (not p ? 'presentation' or p->'presentation' in ('"classic"'::jsonb,'"app"'::jsonb))
    and octet_length(p::text)<=262144,false);
$$;
revoke all on function mathin_internal.valid_miniapp_runtime_spec(jsonb) from public,anon,authenticated;
