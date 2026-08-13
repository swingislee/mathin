-- P6-AIX-2：爱学习 v31 全难度秋季目录。
-- 源包已经把 G+/X+/A+ 的缺源讲次显式区分为占位或目录缺口；这里只建立
-- 可映射的 170 个讲次，真实讲名由 cw-import 从源包幂等回填。

insert into public.course_families
  (slug, title, publisher, stage, subject, edition, description, purpose, status)
values
  ('aixuexi-gplus-primary-math-sujiao', '爱学习小学数学 · G+', '爱学习', '小学', '数学', '苏教版',
   '爱学习 2026 秋季 G+ 苏教版数学，覆盖三至六年级。', 'production', 'enabled'),
  ('aixuexi-xplus-primary-math-sujiao', '爱学习小学数学 · X+', '爱学习', '小学', '数学', '苏教版',
   '爱学习 2026 秋季 X+ 苏教版数学，覆盖一至六年级。', 'production', 'enabled'),
  ('aixuexi-aplus-primary-math-quanguo', '爱学习小学数学 · A+', '爱学习', '小学', '数学', '全国版',
   '爱学习 2026 秋季 A+ 全国版数学，覆盖一至二年级。', 'production', 'enabled')
on conflict (slug) do update set
  title = excluded.title,
  publisher = excluded.publisher,
  stage = excluded.stage,
  subject = excluded.subject,
  edition = excluded.edition,
  description = excluded.description,
  purpose = excluded.purpose,
  status = excluded.status;

with course_seed(family_slug, grade, title, product_code, class_type) as (values
  ('aixuexi-gplus-primary-math-sujiao', 3::smallint, '爱学习 G+ 苏教版数学 · 三年级秋季', 'AXX26G-SJ-03-AUT', 'G+'),
  ('aixuexi-gplus-primary-math-sujiao', 4::smallint, '爱学习 G+ 苏教版数学 · 四年级秋季', 'AXX26G-SJ-04-AUT', 'G+'),
  ('aixuexi-gplus-primary-math-sujiao', 5::smallint, '爱学习 G+ 苏教版数学 · 五年级秋季', 'AXX26G-SJ-05-AUT', 'G+'),
  ('aixuexi-gplus-primary-math-sujiao', 6::smallint, '爱学习 G+ 苏教版数学 · 六年级秋季', 'AXX26G-SJ-06-AUT', 'G+'),
  ('aixuexi-xplus-primary-math-sujiao', 1::smallint, '爱学习 X+ 苏教版数学 · 一年级秋季', 'AXX26X-SJ-01-AUT', 'X+'),
  ('aixuexi-xplus-primary-math-sujiao', 2::smallint, '爱学习 X+ 苏教版数学 · 二年级秋季', 'AXX26X-SJ-02-AUT', 'X+'),
  ('aixuexi-xplus-primary-math-sujiao', 3::smallint, '爱学习 X+ 苏教版数学 · 三年级秋季', 'AXX26X-SJ-03-AUT', 'X+'),
  ('aixuexi-xplus-primary-math-sujiao', 4::smallint, '爱学习 X+ 苏教版数学 · 四年级秋季', 'AXX26X-SJ-04-AUT', 'X+'),
  ('aixuexi-xplus-primary-math-sujiao', 5::smallint, '爱学习 X+ 苏教版数学 · 五年级秋季', 'AXX26X-SJ-05-AUT', 'X+'),
  ('aixuexi-xplus-primary-math-sujiao', 6::smallint, '爱学习 X+ 苏教版数学 · 六年级秋季', 'AXX26X-SJ-06-AUT', 'X+'),
  ('aixuexi-aplus-primary-math-quanguo', 1::smallint, '爱学习 A+ 全国版数学 · 一年级秋季', 'AXX26A-QG-01-AUT', 'A+'),
  ('aixuexi-aplus-primary-math-quanguo', 2::smallint, '爱学习 A+ 全国版数学 · 二年级秋季', 'AXX26A-QG-02-AUT', 'A+')
)
insert into public.courses (family_id, catalog_version_id, title, product_code, grade, term, class_type, status)
select family.id, catalog_version.id, seed.title, seed.product_code, seed.grade, 2, seed.class_type, 'enabled'
  from course_seed seed
  join public.course_families family on family.slug = seed.family_slug
  join public.course_catalog_versions catalog_version
    on catalog_version.family_id = family.id and catalog_version.is_current
on conflict (catalog_version_id, product_code) where product_code is not null do update set
  family_id = excluded.family_id,
  title = excluded.title,
  grade = excluded.grade,
  term = excluded.term,
  class_type = excluded.class_type,
  status = excluded.status;

with lecture_seed(family_slug, grade, no) as (
  select 'aixuexi-gplus-primary-math-sujiao', grade, no
    from generate_series(3, 6) grade
    cross join generate_series(1, 15) no
   where grade in (3, 4) or no not in (7, 15)
  union all
  select 'aixuexi-xplus-primary-math-sujiao', grade, no
    from generate_series(1, 6) grade
    cross join generate_series(1, 15) no
   where grade in (1, 3, 4) or no not in (7, 15)
  union all
  select 'aixuexi-aplus-primary-math-quanguo', grade, no
    from generate_series(1, 2) grade
    cross join generate_series(1, 15) no
)
insert into public.course_lectures(course_id, no, name)
select course.id, seed.no,
       format('第 %s 讲（等待爱学习 v31 导入）', seed.no)
  from lecture_seed seed
  join public.course_families family on family.slug = seed.family_slug
  join public.courses course
    on course.family_id = family.id
   and course.grade = seed.grade
   and course.term = 2
on conflict (course_id, no) do nothing;

do $$
declare
  family_slug text;
  expected_courses int;
  expected_lectures int;
  actual_courses int;
  actual_lectures int;
begin
  for family_slug, expected_courses, expected_lectures in values
    ('aixuexi-gplus-primary-math-sujiao', 4, 56),
    ('aixuexi-xplus-primary-math-sujiao', 6, 84),
    ('aixuexi-aplus-primary-math-quanguo', 2, 30)
  loop
    select count(distinct course.id), count(lecture.id)
      into actual_courses, actual_lectures
      from public.courses course
      join public.course_families family on family.id = course.family_id
      left join public.course_lectures lecture on lecture.course_id = course.id
     where family.slug = family_slug;
    if actual_courses <> expected_courses or actual_lectures <> expected_lectures then
      raise exception 'AIXUEXI_V31_CATALOG_COUNT_MISMATCH family=% courses=%/% lectures=%/%',
        family_slug, actual_courses, expected_courses, actual_lectures, expected_lectures;
    end if;
  end loop;
end;
$$;
