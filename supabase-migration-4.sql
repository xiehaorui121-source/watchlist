-- 迁移 4：新条目 / 新评论时自动调用推送函数。
--
-- 不用控制台的 Database Webhooks，因为那个功能依赖一个叫
-- supabase_functions 的内部 schema，这个项目里没初始化过。
-- 自己写触发器效果完全一样，还少一层依赖。
--
-- 用的是 anon key 而不是 service_role：Edge Function 只要求
-- 一个合法 JWT，而 anon key 本来就是公开的，没必要把
-- service_role 那把万能钥匙写进数据库函数里。
--
-- 运行前把下面的 YOUR-PROJECT 和 YOUR_SUPABASE_PUBLISHABLE_KEY 换成自己项目的值。
-- 重跑安全。

create extension if not exists pg_net;

create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SUPABASE_PUBLISHABLE_KEY'
    ),
    body := jsonb_build_object(
      'type',   TG_OP,
      'table',  TG_TABLE_NAME,
      'record', to_jsonb(NEW)
    ),
    timeout_milliseconds := 5000
  );
  return NEW;
exception when others then
  -- 推送挂了不该连累用户的写入操作
  raise warning '推送触发失败: %', SQLERRM;
  return NEW;
end;
$$;

drop trigger if exists notify_new_item on public.items;
create trigger notify_new_item
  after insert on public.items
  for each row execute function public.notify_push();

drop trigger if exists notify_new_comment on public.comments;
create trigger notify_new_comment
  after insert on public.comments
  for each row execute function public.notify_push();
