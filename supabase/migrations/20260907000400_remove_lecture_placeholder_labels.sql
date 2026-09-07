-- 统一展示正式讲次名称；讲次、内容和课堂冻结记录继续沿用既有身份。
update public.course_lectures
set name = replace(name, '（计划补充占位）', '')
where name like '%（计划补充占位）%';

update public.class_sessions
set title = replace(title, '（计划补充占位）', '')
where title like '%（计划补充占位）%';
