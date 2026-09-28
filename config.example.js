/* 云端同步配置。复制本文件为 config.js，再填上自己 Supabase 项目的值。
   config.js 已写进 .gitignore，不会被提交。步骤见 README.md。 */
window.WL = window.WL || {};
window.WL.config = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY',

  // 推送用的 VAPID 公钥（公钥可以公开）。
  // 配对的私钥只放在 Supabase Secrets 里，绝不能进任何前端文件或仓库。
  vapidPublicKey: 'YOUR_VAPID_PUBLIC_KEY'
};
