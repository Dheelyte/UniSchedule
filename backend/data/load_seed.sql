-- Loads the production data export (seed.sql) into the local database.
-- Run from the backend folder (data/ is mounted at /data in the container):
--   docker exec unilag_db psql -U postgres -d unilag_timetable -f /data/load_seed.sql
-- Needs the Alembic schema in place first (`uv run alembic upgrade head`).
\set ON_ERROR_STOP on

-- seed.sql truncates with CASCADE, which also empties users (it references realms and
-- semesters). Keep the local users so their logins survive.
create temp table _keep_users as select * from public.users;

\i /data/seed.sql

insert into public.users
select k.id, k.email, k.hashed_password, k.role, k.faculty_id,
       case when exists (select 1 from public.semesters s where s.id = k.semester_id) then k.semester_id end,
       k.is_active, k.created_at,
       case when k.realm_key is null or exists (select 1 from public.realms r where r.key = k.realm_key) then k.realm_key end
from _keep_users k
on conflict (id) do nothing;

-- The export has no users table, but its rows point at production user ids
-- (created_by, enrolled_by, locked_by). Add inactive placeholders so those keys resolve.
insert into public.users (id, email, hashed_password, role, is_active, realm_key)
select ids.id, 'prod-user-' || ids.id || '@placeholder.local',
       '$2b$12$vQ37KK9katSovtnquMSv.Ov/0AwPOIJFST4JnRPJlomyCXRgb6Ley',  -- hash of a discarded random string
       'SUPER_VIEWER', false, null
from (
  select created_by as id from public.conflict_dismissals
  union select enrolled_by from public.course_enrollments
  union select locked_by from public.timetable_locks
) ids
where ids.id is not null
  and not exists (select 1 from public.users u where u.id = ids.id);

select setval(pg_get_serial_sequence('public.users', 'id'),
              greatest((select coalesce(max(id), 0) from public.users), 1));

select 'users' as table_name, count(*) as rows from public.users
union all select 'realms', count(*) from public.realms
union all select 'faculties', count(*) from public.faculties
union all select 'departments', count(*) from public.departments
union all select 'academic_sessions', count(*) from public.academic_sessions
union all select 'semesters', count(*) from public.semesters
union all select 'hall_groups', count(*) from public.hall_groups
union all select 'rooms', count(*) from public.rooms
union all select 'courses', count(*) from public.courses
union all select 'course_enrollments', count(*) from public.course_enrollments
union all select 'schedule_items', count(*) from public.schedule_items
union all select 'blocked_slots', count(*) from public.blocked_slots
union all select 'conflict_dismissals', count(*) from public.conflict_dismissals
union all select 'timetable_locks', count(*) from public.timetable_locks;
