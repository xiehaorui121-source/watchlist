/* 数据层。多房间 + 任意人数，全部走 Supabase。
   刻意不做「连不上就退回本地」——那对分享类应用是有害的：
   你以为在用，朋友那边什么都看不到。连不上就明说连不上。 */
(function (WL) {
  'use strict';

  var client = null;

  function loadSdk() {
    if (window.supabase) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Supabase SDK 加载失败，检查网络')); };
      document.head.appendChild(s);
    });
  }

  function connect() {
    if (client) return Promise.resolve(client);
    var cfg = WL.config || {};
    if (!cfg.url || !cfg.anonKey) {
      return Promise.reject(new Error('config.js 里还没填 Supabase 的 url 和 anonKey'));
    }
    return loadSdk().then(function () {
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
      return client;
    });
  }

  function check(res) {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }

  // 去掉了 l/o/0/1 这些看着像的字符
  function randomCode() {
    var A = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < 8; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }

  /* ---------- 本机记的东西：我在哪些房间、每个房间我是谁 ---------- */

  var ROOMS_KEY = 'wl.rooms';

  function myRooms() {
    try { return JSON.parse(localStorage.getItem(ROOMS_KEY)) || []; }
    catch (e) { return []; }
  }

  function rememberRoom(room) {
    var list = myRooms().filter(function (r) { return r.code !== room.code; });
    list.unshift({ code: room.code, name: room.name });
    localStorage.setItem(ROOMS_KEY, JSON.stringify(list.slice(0, 20)));
  }

  function forgetRoom(code) {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(
      myRooms().filter(function (r) { return r.code !== code; })
    ));
    localStorage.removeItem('wl.member.' + code);
  }

  function myMemberId(code) { return localStorage.getItem('wl.member.' + code) || null; }
  function setMyMemberId(code, id) { localStorage.setItem('wl.member.' + code, id); }

  /* 个人钥匙：把一个人在各个房间的成员身份串起来。
     没有它的话「我在哪些房间」只活在 localStorage 里，
     iOS 清一次就全丢了，而且没有任何找回的办法。 */
  var UKEY = 'wl.userkey';

  function randomKey() {
    var A = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < 24; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }

  function userKey() {
    var k = localStorage.getItem(UKEY);
    if (!k) { k = randomKey(); localStorage.setItem(UKEY, k); }
    return k;
  }

  WL.me = {
    key: userKey,
    adopt: function (k) {
      if (k && /^[a-z0-9]{16,40}$/.test(k)) localStorage.setItem(UKEY, k);
    },

    // 这把钥匙名下有几条成员记录
    countMembers: function (k) {
      return connect().then(function (c) {
        return c.from('members').select('id').eq('user_key', k);
      }).then(function (r) { return (r.data || []).length; });
    },

    /* 合并两个身份。
       每套存储空间（电脑 Safari、手机 Safari、主屏幕应用…）都会各自
       生成一把钥匙，所以同一个人很容易分裂成好几个身份，房间散在各处。
       粘找回码是「这也是我」的明确表态，就把旧钥匙名下的成员全部改挂到新钥匙上。 */
    merge: function (fromKey, toKey) {
      if (!fromKey || !toKey || fromKey === toKey) return Promise.resolve(0);
      var moved = 0;
      return connect().then(function (c) {
        return c.from('members').update({ user_key: toKey })
          .eq('user_key', fromKey).select()
          .then(function (r) {
            moved = (r.data || []).length;
            // 推送订阅也得跟着搬家。
            // 漏了这一步的话，订阅会挂在一把再也没人用的旧钥匙下，
            // 推送从此静默失效 —— 而且完全没有报错，最难查的那种。
            return c.from('push_subs').update({ user_key: toKey }).eq('user_key', fromKey);
          });
      }).then(function () { return moved; });
    }
  };

  /* ---------- 推送提醒 ---------- */

  function urlB64ToUint8(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  WL.push = {
    /* iOS 只给「添加到主屏幕」的应用发推送，Safari 标签页里
       PushManager 根本不存在。所以这里要分清「不支持」和「得先装到主屏幕」。 */
    state: function () {
      if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'unsupported';
      if (!('PushManager' in window)) {
        var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        return iOS ? 'needs-install' : 'unsupported';
      }
      if (!(WL.config && WL.config.vapidPublicKey)) return 'unconfigured';
      if (Notification.permission === 'denied') return 'blocked';
      return Notification.permission === 'granted' ? 'maybe-on' : 'off';
    },

    isSubscribed: function () {
      return navigator.serviceWorker.ready
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) { return !!sub; })
        .catch(function () { return false; });
    },

    enable: function (label) {
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('你拒绝了通知权限，可以在系统设置里改回来');
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          return existing || reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8(WL.config.vapidPublicKey)
          });
        });
      }).then(function (sub) {
        var json = sub.toJSON();
        return connect().then(function (c) {
          // endpoint 唯一，同一台设备重订阅就覆盖，不堆重复记录
          return c.from('push_subs').upsert({
            user_key: userKey(),
            endpoint: sub.endpoint,
            sub: json,
            label: label || ''
          }, { onConflict: 'endpoint' });
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return true;
        });
      });
    },

    disable: function () {
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription();
      }).then(function (sub) {
        if (!sub) return true;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return connect().then(function (c) {
            return c.from('push_subs').delete().eq('endpoint', endpoint);
          });
        }).then(function () { return true; });
      });
    }
  };

  /* ---------- 房间级操作 ---------- */

  WL.rooms = {
    list: myRooms,
    forget: forgetRoom,

    create: function (name) {
      return connect().then(function (c) {
        return c.from('rooms').insert({ code: randomCode(), name: name || '' }).select().single();
      }).then(function (res) {
        // 短码撞车的概率极低，真撞了就再来一次
        if (res.error && /duplicate|unique/i.test(res.error.message)) return WL.rooms.create(name);
        var room = check(res);
        rememberRoom(room);
        return room;
      });
    },

    /* 主页数据：我所在的全部房间 + 每个房间的待看情况。
       房间来源有两处，取并集：
         服务端 —— members.user_key 认得我的（换设备也找得回）
         本机   —— localStorage 记的（钥匙还没铺开的老房间也不丢） */
    listAll: function () {
      var key = userKey();
      var local = myRooms();
      var localCodes = local.map(function (r) { return r.code; });

      return connect().then(function (c) {
        return c.from('members').select('*').eq('user_key', key);
      }).then(function (mineRes) {
        var mine = mineRes.data || [];
        var byRoomId = {};
        mine.forEach(function (m) { byRoomId[m.room_id] = m.id; });

        var ids = Object.keys(byRoomId);
        var q = [];
        q.push(ids.length
          ? client.from('rooms').select('*').in('id', ids)
          : Promise.resolve({ data: [] }));
        q.push(localCodes.length
          ? client.from('rooms').select('*').in('code', localCodes)
          : Promise.resolve({ data: [] }));
        return Promise.all(q).then(function (res) {
          var seen = {}, rooms = [];
          (res[0].data || []).concat(res[1].data || []).forEach(function (r) {
            if (seen[r.id]) return;
            seen[r.id] = 1;
            // 本机房间可能没写过钥匙，回落到 localStorage 里的成员 id
            r.myMemberId = byRoomId[r.id] || myMemberId(r.code);
            rooms.push(r);
          });
          return rooms;
        });
      }).then(function (rooms) {
        if (!rooms.length) return [];
        var roomIds = rooms.map(function (r) { return r.id; });
        return Promise.all([
          client.from('members').select('id,room_id,name,avatar,user_key').in('room_id', roomIds),
          client.from('items').select('id,room_id').is('archived_at', null).in('room_id', roomIds),
          client.from('watches').select('item_id,member_id,room_id').in('room_id', roomIds)
        ]).then(function (res) {
          var members = res[0].data || [];
          var items = res[1].data || [];
          var watches = res[2].data || [];

          var watchedBy = {};
          watches.forEach(function (w) {
            (watchedBy[w.item_id] = watchedBy[w.item_id] || {})[w.member_id] = 1;
          });

          // 本机知道我是谁、但那条成员记录还没挂钥匙的，就地补上。
          // 不这么做的话，这些房间只活在 localStorage 里，换设备就没了。
          var orphans = [];
          rooms.forEach(function (r) {
            var mid = r.myMemberId;
            if (!mid) return;
            var row = members.filter(function (m) { return m.id === mid; })[0];
            if (row && !row.user_key) orphans.push(mid);
          });
          if (orphans.length) {
            client.from('members').update({ user_key: userKey() })
              .in('id', orphans).is('user_key', null).then(function () {}, function () {});
          }

          rooms.forEach(function (r) {
            r.members = members.filter(function (m) { return m.room_id === r.id; });
            var mineItems = items.filter(function (i) { return i.room_id === r.id; });
            r.todo = mineItems.length;
            r.waitingOnMe = r.myMemberId
              ? mineItems.filter(function (i) {
                  return !(watchedBy[i.id] && watchedBy[i.id][r.myMemberId]);
                }).length
              : 0;
            // 顺手把房间名同步回本机缓存，改过名字也能对上
            rememberRoom(r);
          });
          rooms.sort(function (a, b) {
            return (b.waitingOnMe - a.waitingOnMe) || (b.todo - a.todo);
          });
          return rooms;
        });
      });
    },

    open: function (code) {
      return connect().then(function (c) {
        return c.from('rooms').select('*').eq('code', code).maybeSingle();
      }).then(function (res) {
        var room = check(res);
        if (!room) throw new Error('房间不存在，检查一下链接是不是完整');
        return new Store(client, room);
      });
    }
  };

  /* ---------- 单个房间的数据 ---------- */

  function Store(c, room) {
    this.c = c;
    this.room = room;
    this.listeners = [];
    this.state = { room: room, members: [], items: [], meId: myMemberId(room.code) };
  }

  Store.prototype.getState = function () { return this.state; };

  Store.prototype.onChange = function (cb) {
    this.listeners.push(cb);
    cb(this.state);
  };

  Store.prototype.emit = function () {
    var s = this.state;
    this.listeners.forEach(function (cb) { cb(s); });
  };

  Store.prototype.me = function () {
    var id = this.state.meId, list = this.state.members;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  Store.prototype.init = function () {
    var self = this;
    var rid = this.room.id;
    // 按 room_id 过滤订阅：别的房间的动静不该推到这台设备上
    var ch = this.c.channel('room-' + this.room.code);
    ['members', 'items', 'watches', 'comments'].forEach(function (table) {
      ch.on('postgres_changes',
        { event: '*', schema: 'public', table: table, filter: 'room_id=eq.' + rid },
        function () { self.refresh(); });
    });
    ch.subscribe();
    return this.refresh();
  };

  Store.prototype.refresh = function () {
    var self = this, rid = this.room.id;
    return Promise.all([
      this.c.from('members').select('*').eq('room_id', rid).order('created_at'),
      this.c.from('items').select('*').eq('room_id', rid).order('created_at', { ascending: false }),
      this.c.from('watches').select('*').eq('room_id', rid),
      this.c.from('comments').select('*').eq('room_id', rid).order('created_at')
    ]).then(function (res) {
      var members = res[0].data || [];
      var items = res[1].data || [];
      var watches = res[2].data || [];
      var comments = res[3].data || [];

      var byItem = {}, cmByItem = {};
      watches.forEach(function (w) { (byItem[w.item_id] = byItem[w.item_id] || []).push(w.member_id); });
      comments.forEach(function (c) { (cmByItem[c.item_id] = cmByItem[c.item_id] || []).push(c); });
      items.forEach(function (i) {
        i.watchers = byItem[i.id] || [];
        i.comments = cmByItem[i.id] || [];
      });

      // 本机不知道我是谁（换设备、或 localStorage 被清），
      // 就用个人钥匙在这个房间里把自己认出来
      var meId = self.state.meId;
      if (!meId) {
        var k = userKey();
        var mine = members.filter(function (m) { return m.user_key && m.user_key === k; })[0];
        if (mine) { meId = mine.id; setMyMemberId(self.room.code, meId); }
      }

      self.state = { room: self.room, members: members, items: items, meId: meId };
      self.emit();
    });
  };

  /* 加入房间 = 在这个房间建一条 member 记录 */
  Store.prototype.join = function (profile) {
    var self = this;
    return this.c.from('members').insert({
      room_id: this.room.id,
      name: profile.name,
      avatar: profile.avatar || '',
      user_key: userKey()
    }).select().single().then(function (res) {
      var m = check(res);
      setMyMemberId(self.room.code, m.id);
      self.state.meId = m.id;
      rememberRoom(self.room);
      return self.refresh();
    });
  };

  /* 认领一个已经存在的成员身份。
     用途：换设备，或者 iOS 把 localStorage 清了导致身份丢失。
     没有这条路的话，人只能重新「加入」，房间里就会堆出幽灵成员，
     而「所有人都看过」从此永远凑不齐。 */
  Store.prototype.claim = function (memberId) {
    var self = this;
    setMyMemberId(this.room.code, memberId);
    this.state.meId = memberId;
    rememberRoom(this.room);
    this.emit();
    // 认领是明确的用户动作，直接把钥匙按上去
    return this.c.from('members').update({ user_key: userKey() })
      .eq('id', memberId).then(function () { return self.refresh(); });
  };

  /* 老成员补钥匙。只在 user_key 还空着时写，
     免得把别人已经认领的身份从他的主页上抢走。 */
  Store.prototype.adoptIfOrphan = function () {
    var me = this.me();
    if (!me || me.user_key) return Promise.resolve();
    return this.c.from('members').update({ user_key: userKey() })
      .eq('id', me.id).is('user_key', null).then(function () {});
  };

  Store.prototype.updateMe = function (profile) {
    var self = this;
    return this.c.from('members').update({
      name: profile.name, avatar: profile.avatar || ''
    }).eq('id', this.state.meId).then(function () { return self.refresh(); });
  };

  Store.prototype.removeMember = function (memberId) {
    var self = this;
    return this.c.from('members').delete().eq('id', memberId)
      .then(function () { return self.recomputeArchives(); });
  };

  /* 删完人必须重算归档。
     少一个人 = 门槛降低，那些「剩下的人其实都看过了」的条目
     本该立刻变成已完成；不重算的话它们会永远卡在待看里。 */
  Store.prototype.recomputeArchives = function () {
    var self = this;
    return this.refresh().then(function () {
      var st = self.state;
      var ids = st.members.map(function (m) { return m.id; });
      if (ids.length < 2) return;
      var todo = st.items.filter(function (i) {
        return !i.archived_at && ids.every(function (id) {
          return i.watchers.indexOf(id) >= 0;
        });
      });
      if (!todo.length) return;
      var now = new Date().toISOString();
      return Promise.all(todo.map(function (i) {
        return self.c.from('items').update({ archived_at: now }).eq('id', i.id);
      })).then(function () { return self.refresh(); });
    });
  };

  Store.prototype.renameRoom = function (name) {
    var self = this;
    return this.c.from('rooms').update({ name: name }).eq('id', this.room.id)
      .then(function () {
        self.room.name = name;
        rememberRoom(self.room);
        self.emit();
      });
  };

  Store.prototype.addItem = function (data) {
    var self = this;
    return this.c.from('items').insert({
      room_id: this.room.id,
      url: data.url,
      title: data.title || data.url,
      platform: data.platform || 'other',
      added_by: this.state.meId
    }).then(function () { return self.refresh(); });
  };

  Store.prototype.find = function (id) {
    var list = this.state.items;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  /* 打勾只管自己那一条 watch 记录。改完重新算这条是不是所有人都看过了。 */
  Store.prototype.toggleWatched = function (itemId) {
    var self = this;
    var item = this.find(itemId);
    if (!item) return Promise.resolve();
    var meId = this.state.meId;
    var had = item.watchers.indexOf(meId) >= 0;

    var op = had
      ? this.c.from('watches').delete().eq('item_id', itemId).eq('member_id', meId)
      : this.c.from('watches').insert({ item_id: itemId, member_id: meId, room_id: this.room.id });

    return op.then(function () {
      var next = had
        ? item.watchers.filter(function (w) { return w !== meId; })
        : item.watchers.concat([meId]);
      return self.syncArchive(item, next, had ? 'uncheck' : 'check');
    }).then(function () { return self.refresh(); });
  };

  /* 归档规则：房间至少两个人，且每个人都看过。
     关键是「勾上」和「取消勾」不对称：

       勾上   —— 只可能让一条完成，绝不会让已完成的退回。
       取消勾 —— 撤销归档（本人明确表示自己其实没看）。

     不这么分的话会有个反直觉的 bug：老条目归档后又进了新人，
     新人去勾它时 watchers 仍然凑不齐当前人数，那条反而被撤销归档，
     等于「打勾让进度倒退」。 */
  Store.prototype.syncArchive = function (item, watchers, action) {
    if (action === 'uncheck') {
      return item.archived_at
        ? this.c.from('items').update({ archived_at: null }).eq('id', item.id)
        : Promise.resolve();
    }
    var total = this.state.members.length;
    var allSeen = total >= 2 && watchers.length >= total;
    return (allSeen && !item.archived_at)
      ? this.c.from('items').update({ archived_at: new Date().toISOString() }).eq('id', item.id)
      : Promise.resolve();
  };

  Store.prototype.addComment = function (itemId, text) {
    var self = this;
    return this.c.from('comments').insert({
      item_id: itemId, room_id: this.room.id, member_id: this.state.meId, text: text
    }).then(function () { return self.refresh(); });
  };

  Store.prototype.deleteItem = function (itemId) {
    var self = this;
    return this.c.from('items').delete().eq('id', itemId)
      .then(function () { return self.refresh(); });
  };
})(window.WL = window.WL || {});
