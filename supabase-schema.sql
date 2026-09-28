-- 在 Supabase 控制台 → SQL Editor 里整段粘贴运行。
-- 注意：开头会清掉旧表。之前那版是「单房间 + 固定两人」，
-- 这版是「多房间 + 任意人数」，结构不兼容，直接重建。

drop table if exists comments cascade;
drop table if exists watches  cascade;
drop table if exists items    cascade;
drop table if exists members  cascade;
drop table if exists rooms    cascade;
drop table if exists room     cascade;   -- 旧的单房间表

-- 房间。code 是出现在网址里的短码，也是唯一的门禁。
create table rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null default '',
  created_at  timestamptz not null default now()
);

-- 成员。同一个人在不同房间是不同的 member 记录，可以用不同名字头像。
create table members (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  name        text not null,
  avatar      text not null default '',
  created_at  timestamptz not null default now()
);

create table items (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  url         text not null,
  title       text not null,
  platform    text not null default 'other',
  added_by    uuid references members(id) on delete set null,
  -- 一旦所有人都看过就打上时间戳。之后新人加入也不会让旧条目重新冒出来。
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

-- 谁看过哪条。取代原来写死的 watched_a / watched_b 两列。
create table watches (
  item_id     uuid not null references items(id)    on delete cascade,
  member_id   uuid not null references members(id)  on delete cascade,
  room_id     uuid not null references rooms(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (item_id, member_id)
);

create table comments (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id)   on delete cascade,
  room_id     uuid not null references rooms(id)   on delete cascade,
  member_id   uuid references members(id) on delete set null,
  text        text not null,
  created_at  timestamptz not null default now()
);

create index members_room_idx   on members(room_id);
create index items_room_idx     on items(room_id, created_at desc);
create index watches_room_idx   on watches(room_id);
create index comments_item_idx  on comments(item_id);
create index comments_room_idx  on comments(room_id);

-- 实时推送
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table items;
alter publication supabase_realtime add table watches;
alter publication supabase_realtime add table comments;

-- 访问策略：开 RLS 然后放行 anon。
-- 门禁是房间短码本身——知道网址的人才进得来。
-- 前端订阅时按 room_id 过滤，所以别的房间的动静不会推送到你这。
alter table rooms    enable row level security;
alter table members  enable row level security;
alter table items    enable row level security;
alter table watches  enable row level security;
alter table comments enable row level security;

create policy "anon all rooms"    on rooms    for all to anon using (true) with check (true);
create policy "anon all members"  on members  for all to anon using (true) with check (true);
create policy "anon all items"    on items    for all to anon using (true) with check (true);
create policy "anon all watches"  on watches  for all to anon using (true) with check (true);
create policy "anon all comments" on comments for all to anon using (true) with check (true);
