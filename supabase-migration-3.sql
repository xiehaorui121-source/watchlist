-- 迁移 3：存推送订阅。
-- 挂在 user_key 上而不是 member 上 —— 提醒是给「人」的，
-- 一个人在几个房间都用同一台手机收。
-- 纯追加，重跑安全。

create table if not exists push_subs (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  endpoint    text not null unique,   -- 同一台设备重复订阅时覆盖，不堆重复
  sub         jsonb not null,         -- 完整的 PushSubscription
  label       text,                   -- 「iPhone」之类，方便自己认
  created_at  timestamptz not null default now()
);

create index if not exists push_subs_user_idx on push_subs(user_key);

alter table push_subs enable row level security;

drop policy if exists "anon all push_subs" on push_subs;
create policy "anon all push_subs" on push_subs for all to anon using (true) with check (true);
