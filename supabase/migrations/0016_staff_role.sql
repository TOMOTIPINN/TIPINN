-- 0016_staff_role.sql
-- スタッフの権限列 role（認証B / [[auth-method-line-b]]）を明示的にmigration化する。
-- 経緯: role は本番DBには存在するが、これまで作成SQLがどのmigrationにも無かった（0007欠番の手動追加分）。
--       migrations/ からの再構築で role 列が欠落し、店長ガード（requireManager）が壊れるのを防ぐ。
-- 値: 'staff'（既定）/ 'manager'。既存行非破壊・冪等（if not exists）。適用は SQL Editor で手動（CLAUDE.md §3）。
alter table public.staff
  add column if not exists role text not null default 'staff';

-- CHECK は上の add column が既存列でスキップされる（=本番）ため、別途冪等に付与する。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_role_check'
  ) then
    alter table public.staff
      add constraint staff_role_check check (role in ('staff', 'manager'));
  end if;
end $$;
