-- 迁移 5：打勾也走推送触发器。
--
-- 注意：函数本身会判断「这一勾是不是让全员看完了」，
-- 不满足条件就直接返回，不会每次打勾都推。
-- 所以这里只管把事件送过去，筛选逻辑在 Edge Function 里。
--
-- 重跑安全。

drop trigger if exists notify_all_watched on public.watches;
create trigger notify_all_watched
  after insert on public.watches
  for each row execute function public.notify_push();
