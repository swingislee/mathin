-- 查询迁移补发后的统计兼容层。只重放已发布的用途/别称过滤，不修改身份或业务记录。
do $views$
declare relation text;
begin
  foreach relation in array array['lead_communications','activity_registrations'] loop
    if not exists(select 1 from pg_class where oid=('public.statistics_'||relation)::regclass
      and reloptions @> array['security_invoker=true']) then
      raise exception 'STATISTICS_VIEW_SECURITY_CHANGED';
    end if;
  end loop;
end;
$views$;

-- SELECT * 在创建视图时展开；先上线统计视图的目标需补齐后来生成的投影列。
create or replace view public.statistics_lead_communications with(security_invoker=true) as
  select r.* from public.business_lead_communications r
  where public.statistics_identity_included(null,r.lead_id,r.owner_id_at_contact)
    and public.statistics_source_included(r.source_record_id,r.source_metric_facts);
create or replace view public.statistics_activity_registrations with(security_invoker=true) as
  select r.* from public.business_activity_registrations r
  where public.statistics_identity_included(r.student_id,r.lead_id)
    and public.statistics_source_included(r.source_record_id,r.source_metric_facts)
    and exists(select 1 from public.statistics_activities a where a.id=r.activity_id);

do $readers$
declare signature text; body text; relation text;
begin
  foreach signature in array array['public.list_current_staff_overview_acquisition_sources(text,integer)',
    'public.staff_overview_acquisition_contact_facts_v2(text,text)'] loop
    if to_regprocedure(signature) is null then raise exception 'STATISTICS_READER_MISSING';end if;
    body:=pg_get_functiondef(to_regprocedure(signature));
    if signature like '%list_current_%' then
      body:=replace(body,'select * from latest where p_after is null or id > p_after',
        'select * from latest where public.statistics_source_included(id) and (p_after is null or id > p_after)');
      if strpos(body,'select * from latest where public.statistics_source_included(id) and (p_after is null or id > p_after)')=0 then
        raise exception 'STATISTICS_ACQUISITION_SCOPE_MISSING';
      end if;
    else
      foreach relation in array array['leads','lead_communications','activity_registrations','assessment_results','activities','lead_source_records','profiles'] loop
        body:=replace(body,'public.'||relation||' ','public.statistics_'||relation||' ');
        if strpos(body,'public.statistics_'||relation||' ')=0 then raise exception 'STATISTICS_FACT_SCOPE_MISSING: %',relation;end if;
      end loop;
      body:=replace(body,'from latest h left join source_leads',
        'from (select * from latest where public.statistics_source_included(id)) h left join source_leads');
      if strpos(body,'any(p.staff_aliases)')=0 then
        body:=replace(body,'public.overview_trim_v2(p.display_name)=public.overview_trim_v2(names.label)',
          '(public.overview_trim_v2(p.display_name)=public.overview_trim_v2(names.label) or public.overview_trim_v2(names.label)=any(p.staff_aliases))');
      end if;
      if strpos(body,'any(p.staff_aliases)')=0 or strpos(body,'where public.statistics_source_included(id)) h')=0 then
        raise exception 'STATISTICS_FACT_ALIAS_OR_SOURCE_SCOPE_MISSING';
      end if;
    end if;
    execute body;
  end loop;
  perform set_config('mathin.statistics_reader_upgrade_pending','false',true);
end;
$readers$;
