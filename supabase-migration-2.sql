-- 迁移 2：给每个人一把「个人钥匙」，把他在各个房间的成员身份串起来。
--
-- 为什么需要：在这之前，「我在哪些房间」只存在浏览器的 localStorage 里。
-- iOS Safari 七天不访问就会清空它，清空之后房间就再也找不回来了
-- （认领功能只在你手上还有那个房间链接时才管用）。
-- 有了 user_key，一条个人链接就能在任何设备上把所有房间捞回来。
--
-- 这个脚本是纯追加的，不会动任何现有数据，重跑也安全。

alter table members add column if not exists user_key text;
create index if not exists members_user_key_idx on members(user_key);
