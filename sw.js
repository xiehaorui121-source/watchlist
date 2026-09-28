/* 只缓存自家静态文件，数据始终走网络。

   VERSION 每次改动前端代码都要改。这不只是洁癖：sw.js 的字节内容变了，
   浏览器才会认为有新版本、才会重新 install、才会清掉旧缓存桶。
   之前 VERSION 写死不动，导致老用户可能一直跑着旧代码，
   而数据库结构已经变了 —— 表现就是「链接失效」。 */
var VERSION = '2026-08-26-a';
var CACHE = 'watchlist-' + VERSION;

var SHELL = [
  './', './index.html', './app.css',
  './config.js', './parse.js', './store.js', './app.js',
  './manifest.json', './icons/icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch (err) { data = { body: e.data ? e.data.text() : '' }; }

  e.waitUntil(self.registration.showNotification(data.title || '共享待看', {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    // 同一个房间的新消息互相覆盖，别把通知中心刷屏
    tag: data.tag || 'watchlist',
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) {
          if (c.navigate) { try { c.navigate(url); } catch (err) { /* 跨源就算了 */ } }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;      // Supabase / CDN 一律走网络
  if (url.pathname.endsWith('/sw.js')) return;     // 自己永远别走缓存

  // 先拿网络（保证改动能生效），失败再回退缓存。
  // cache:'no-cache' = 每次都带 If-None-Match 去问服务器，
  // 没变就吃 304，很快；但绝不会拿到浏览器 HTTP 缓存里的旧文件。
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
