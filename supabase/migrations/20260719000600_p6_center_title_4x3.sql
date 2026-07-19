-- P6-6 补充 F：中心标题页。背景从 16:9 中央裁为 4:3，标题元素保持原比例与纵向位置。
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
      from pg_constraint
     where conrelid = 'public.cw_page_docs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%adapt_class%'
  loop
    execute format('alter table public.cw_page_docs drop constraint %I', constraint_name);
  end loop;
end;
$$;
alter table public.cw_page_docs
  add constraint cw_page_docs_adapt_class_check
  check (adapt_class is null or adapt_class in ('A', 'B', 'C', 'D', 'E', 'F'));
