const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${sql(JSON.stringify(value))}::jsonb`;

export function buildIncrementalSourcePreflight(plan, contentHash, targetLectureId) {
  return `select json_build_object(
    'receiptCount',count(receipt.source_lecture_id),
    'contentMatches',coalesce(bool_and(receipt.content_sha256=${sql(contentHash)}),false),
    'mappingMatches',coalesce(bool_and(source.lecture_id=${sql(targetLectureId)}::uuid),false),
    'pageCount',(select count(*) from public.cw_page_docs page where page.lecture_id=${sql(targetLectureId)}::uuid),
    'releaseCount',(select count(*) from public.cw_lecture_releases release where release.lecture_id=${sql(targetLectureId)}::uuid)
  ) from public.cw_source_lecture_imports receipt
    join public.cw_source_lectures source on source.id=receipt.source_lecture_id
    join public.cw_source_packages package on package.id=source.source_package_id
  where package.source_system='aixuexi_bsk' and package.package_key=${sql(plan.lecture.sourcePackageKey)}
    and source.source_courseware_id=${sql(plan.lecture.coursewareId)};`;
}

export function assertIncrementalSourceState(state) {
  if (state.receiptCount > 0) {
    if (!state.mappingMatches) throw new Error("CW_IMPORT_INCREMENTAL_MAPPING_CHANGED: 已导入讲次的目标目录发生变化");
    if (state.receiptCount !== 1 || !state.contentMatches) throw new Error("CW_IMPORT_INCREMENTAL_CONTENT_CHANGED: 已导入讲次内容发生变化，请进入版本升级流程");
    return "reuse";
  }
  if (state.pageCount > 0 || state.releaseCount > 0 || state.templatePageCount > 0) throw new Error("CW_IMPORT_INCREMENTAL_TARGET_HAS_CONTENT: 目标讲次已有内容，请进入版本升级流程");
  return "add";
}

export function incrementalSourceSql(plan, contentHash) {
  const lecture = plan.lecture;
  const packageFilter = `package.source_system='aixuexi_bsk' and package.package_key=${sql(lecture.sourcePackageKey)}`;
  return {
    guard: `do $$ begin
      if exists(select 1 from public.cw_source_lecture_imports receipt
        join public.cw_source_lectures source on source.id=receipt.source_lecture_id
        join cw_import_context context on context.lecture_id=source.lecture_id)
      then raise exception 'CW_IMPORT_INCREMENTAL_RECEIPT_EXISTS'; end if;
      if exists(select 1 from public.cw_page_docs page join cw_import_context context on context.lecture_id=page.lecture_id)
        or exists(select 1 from public.cw_lecture_releases release join cw_import_context context on context.lecture_id=release.lecture_id)
        or exists(select 1 from public.course_lectures lecture join cw_import_context context on context.lecture_id=lecture.id
          where lecture.current_release_id is not null or coalesce(jsonb_array_length(lecture.courseware_template),0)>0)
      then raise exception 'CW_IMPORT_INCREMENTAL_TARGET_HAS_CONTENT'; end if;
      if exists(select 1 from public.cw_source_lectures source join public.cw_source_packages package on package.id=source.source_package_id
        where ${packageFilter} and source.source_courseware_id=${sql(lecture.coursewareId)}
          and source.lecture_id not in (select lecture_id from cw_import_context))
      then raise exception 'CW_IMPORT_INCREMENTAL_MAPPING_CHANGED'; end if;
    end $$;`,
    provenance: `
insert into public.cw_source_packages(source_system,package_key,document_adapter,manifest_sha256,labels,scope,counts,status)
values ('aixuexi_bsk',${sql(lecture.sourcePackageKey)},${sql(lecture.documentAdapter)},${sql(lecture.sourcePackageManifestSha256)},
  ${json(lecture.sourcePackageLabels ?? {})},${json(lecture.sourcePackageScope ?? {})},${json(lecture.sourcePackageCounts ?? {})},'importing')
on conflict(source_system,package_key) do nothing;
insert into public.cw_source_package_snapshots(source_package_id,manifest_sha256,document_adapter,labels,scope,counts,manifest)
select package.id,${sql(lecture.sourcePackageManifestSha256)},${sql(lecture.documentAdapter)},
  ${json(lecture.sourcePackageLabels ?? {})},${json(lecture.sourcePackageScope ?? {})},${json(lecture.sourcePackageCounts ?? {})},${json(plan.sourceManifest ?? null)}
from public.cw_source_packages package where ${packageFilter}
on conflict(source_package_id,manifest_sha256) do nothing;
insert into public.cw_source_lectures(source_package_id,lecture_id,source_product_code,source_courseware_id,source_lesson_index,offline_status,page_count,verification_sha256)
select package.id,context.lecture_id,${sql(lecture.sourceProductCode)},${sql(lecture.coursewareId)},${lecture.lessonIndex},'complete',${plan.pages.length},${lecture.verificationSha256 ? sql(lecture.verificationSha256) : "null"}
from public.cw_source_packages package cross join cw_import_context context where ${packageFilter};`,
    receipt: `insert into public.cw_source_lecture_imports(source_lecture_id,source_snapshot_id,content_sha256,native_release_id,adapted_release_id)
select source.id,snapshot.id,${sql(contentHash)},native.id,adapted.id
from cw_import_context context
join public.cw_source_lectures source on source.lecture_id=context.lecture_id
join public.cw_source_package_snapshots snapshot on snapshot.source_package_id=source.source_package_id and snapshot.manifest_sha256=${sql(lecture.sourcePackageManifestSha256)}
join public.cw_lecture_releases native on native.lecture_id=context.lecture_id and native.track='native-16x9' and native.release_no=1
join public.cw_lecture_releases adapted on adapted.lecture_id=context.lecture_id and adapted.track='adapted-4x3' and adapted.release_no=1;`,
  };
}
