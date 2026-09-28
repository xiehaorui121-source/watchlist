(function (WL) {
  'use strict';

  var store = null;
  var tab = 'todo';
  var pending = null;                 // 解析出来待确认的那条
  var draft = null;                   // 资料编辑中的 {name, avatar, mode}

  var EMOJI = ['🐱','🐶','🦊','🐼','🐯','🦁','🐨','🐸','🌵','🍑','🌙','⚡','🎧','📚','🍜','🎬'];
  var FALLBACK_COLORS = ['#3b7dd8','#d8683b','#2f9e6e','#8b5cf6','#d84b7d','#c99700'];

  var $ = function (s) { return document.querySelector(s); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function roomCodeFromUrl() {
    return new URLSearchParams(location.search).get('r');
  }

  function showScreen(id) {
    ['#screenRooms','#screenJoin','#screenError','#app'].forEach(function (s) {
      $(s).hidden = (s !== id);
    });
  }

  /* ---------- 成员与头像 ---------- */

  function memberById(id) {
    var list = store.getState().members;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function nameOf(id) {
    var m = memberById(id);
    return m ? m.name : '已退出';
  }

  function colorFor(id) {
    var list = store.getState().members;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    }
    return '#888780';
  }

  function avatarMarkup(avatar, name, color, px) {
    var base = 'width:'+px+'px;height:'+px+'px;border-radius:50%;flex:none;';
    if (avatar && avatar.indexOf('data:') === 0) {
      return '<span class="avatar" style="'+base+'background-image:url('+esc(avatar)+')"></span>';
    }
    if (avatar) {
      return '<span class="avatar emoji" style="'+base+'font-size:'+Math.round(px*0.58)+'px">'+esc(avatar)+'</span>';
    }
    return '<span class="avatar initial" style="'+base+'background:'+color+
      ';font-size:'+Math.round(px*0.45)+'px">'+esc((name||'?').trim().charAt(0))+'</span>';
  }

  function avatarOf(id, px) {
    var m = memberById(id);
    if (!m) return avatarMarkup('', '?', '#888780', px || 28);
    return avatarMarkup(m.avatar, m.name, colorFor(id), px || 28);
  }

  function platformInfo(id) {
    var all = WL.parse.PLATFORMS.concat([WL.parse.OTHER]);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return WL.parse.OTHER;
  }

  function timeAgo(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d/60) + ' 分钟前';
    if (d < 86400) return Math.floor(d/3600) + ' 小时前';
    if (d < 172800) return '昨天';
    if (d < 2592000) return Math.floor(d/86400) + ' 天前';
    return new Date(iso).toLocaleDateString('zh-CN');
  }

  /* ---------- 头像上传 ---------- */

  function fileToAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file || file.type.indexOf('image/') !== 0) { reject(new Error('选一张图片文件')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var S = 160, canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        var ctx = canvas.getContext('2d');
        var side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0, 0, S, S);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('这张图读不出来，换一张')); };
      img.src = url;
    });
  }

  /* ---------- 资料编辑（加入房间 / 改自己） ---------- */

  function openEditor(mode) {
    var m = mode === 'join' ? null : store.me();
    draft = { mode: mode, name: m ? m.name : '', avatar: m ? m.avatar : '' };
    $('#editorTitle').textContent = mode === 'join' ? '你在这个房间叫什么' : '你的资料';
    $('#nameInput').value = draft.name;
    $('#editorErr').textContent = '';
    renderEditor();
    $('#editor').hidden = false;
    setTimeout(function () { $('#nameInput').focus(); }, 50);
  }

  function closeEditor() { draft = null; $('#editor').hidden = true; }

  function renderEditor() {
    if (!draft) return;
    $('#editorAvatar').innerHTML =
      avatarMarkup(draft.avatar, draft.name, FALLBACK_COLORS[0], 72);
    $('#emojiGrid').innerHTML = EMOJI.map(function (e) {
      return '<button type="button" class="emoji-opt'+(draft.avatar===e?' on':'')+
        '" data-emoji="'+e+'">'+e+'</button>';
    }).join('');
    $('#emojiGrid').querySelectorAll('[data-emoji]').forEach(function (b) {
      b.addEventListener('click', function () { draft.avatar = b.dataset.emoji; renderEditor(); });
    });
  }

  function saveEditor() {
    var name = $('#nameInput').value.trim();
    var err = $('#editorErr');
    if (!name) { err.textContent = '起个名字吧'; $('#nameInput').focus(); return; }
    if (name.length > 12) { err.textContent = '名字太长了，12 个字以内'; return; }
    err.textContent = '';
    var isJoin = draft.mode === 'join';
    var profile = { name: name, avatar: draft.avatar };
    closeEditor();
    (isJoin ? store.join(profile) : store.updateMe(profile))
      .then(function () { showScreen('#app'); render(); })
      .catch(function (e) { fail(e.message); });
  }

  /* ---------- 加入房间 ---------- */

  function renderJoinScreen() {
    var st = store.getState();
    $('#joinRoomName').textContent = st.room.name || '这个房间';

    if (st.members.length) {
      // 房间里已经有人了：优先让来人认领自己，而不是无脑新建一个成员
      $('#claimList').innerHTML =
        '<p class="muted small claim-q">你是其中哪一位？</p>' +
        '<div class="claim-row">' + st.members.map(function (m) {
          return '<button class="claim" data-id="'+esc(m.id)+'">' +
            avatarMarkup(m.avatar, m.name, colorFor(m.id), 44) +
            '<span>'+esc(m.name)+'</span></button>';
        }).join('') + '</div>';
      $('#claimList').hidden = false;
      $('#joinHint').textContent = '换了手机、或者太久没打开身份丢了，就在上面认领自己。';
      $('#joinBtn').textContent = '都不是，我是新来的';
      $('#claimList').querySelectorAll('.claim').forEach(function (b) {
        b.addEventListener('click', function () {
          store.claim(b.dataset.id).then(function () {
            showScreen('#app'); render();
          });
        });
      });
    } else {
      $('#claimList').hidden = true;
      $('#joinHint').textContent = '设个名字和头像，同一个人在不同房间可以不一样。';
      $('#joinBtn').textContent = '加入';
    }
    showScreen('#screenJoin');
  }

  /* ---------- 房间列表 ---------- */

  function roomCardHtml(r) {
    var avatars = r.members.slice(0, 5).map(function (m) {
      return avatarMarkup(m.avatar, m.name, memberColor(r, m.id), 22);
    }).join('');
    var sub = r.members.length + ' 人 · ' +
      (r.todo ? r.todo + ' 条待看' : '清单空着');

    return '<a class="room-row" href="?r='+encodeURIComponent(r.code)+'">' +
      '<span class="room-main">' +
        '<span class="room-name">'+esc(r.name || '未命名房间')+'</span>' +
        '<span class="room-sub"><span class="room-faces">'+avatars+'</span>'+esc(sub)+'</span>' +
      '</span>' +
      (r.waitingOnMe
        ? '<span class="room-badge">'+r.waitingOnMe+' 条等你</span>'
        : '<span class="room-code">'+esc(r.code)+'</span>') +
    '</a>';
  }

  // 主页没有 store，颜色按该房间内的成员顺序算
  function memberColor(room, id) {
    for (var i = 0; i < room.members.length; i++) {
      if (room.members[i].id === id) return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    }
    return '#888780';
  }

  function renderRoomPicker() {
    showScreen('#screenRooms');
    $('#roomList').innerHTML = '<p class="empty">正在载入…</p>';
    renderNotify();

    WL.rooms.listAll().then(function (rooms) {
      $('#roomList').innerHTML = rooms.length
        ? rooms.map(roomCardHtml).join('')
        : '<p class="empty">这里还没有房间。<br><br>' +
          '<b>刚把它加到主屏幕？</b>主屏幕应用有独立的存储，' +
          '不会自动带上你在浏览器里的身份——<br>' +
          '到下面点「我要找回房间」，把找回码粘进来就都回来了。<br><br>' +
          '朋友发过邀请链接的话，直接打开那个链接；<br>' +
          '想自己开一个，用下面的输入框。</p>';
    }).catch(function (e) {
      // 网络挂了也别让人对着空白页，本机缓存至少能点进去
      var local = WL.rooms.list();
      $('#roomList').innerHTML = (local.length
        ? local.map(function (r) {
            return '<a class="room-row" href="?r='+encodeURIComponent(r.code)+'">' +
              '<span class="room-main"><span class="room-name">'+esc(r.name||'未命名房间')+'</span>' +
              '<span class="room-sub">离线，看不到最新情况</span></span></a>';
          }).join('')
        : '') +
        '<p class="empty">连不上服务器：'+esc(e.message)+'</p>';
    });
  }

  function copyMyLink() {
    var link = location.origin + location.pathname + '?me=' + WL.me.key();
    var btn = $('#copyMyLink');
    var done = function () {
      btn.textContent = '已复制，存到备忘录';
      setTimeout(function () { btn.textContent = '复制我的找回码'; }, 2600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { prompt('保存这条：', link); });
    } else {
      prompt('保存这条：', link);
    }
  }

  /* 主屏幕应用没有地址栏，?me= 链接根本没处输入。
     iOS 上「添加到主屏幕」还会开一套独立存储，不跟 Safari 共享，
     所以那边一定是空的 —— 必须能手动把找回码粘进来。
     链接和纯码都收。 */
  function restoreRooms() {
    var raw = $('#restoreInput').value.trim();
    var err = $('#restoreErr');
    var m = raw.match(/[?&]me=([a-z0-9]+)/i);
    var key = m ? m[1] : raw;

    if (!/^[a-z0-9]{16,40}$/.test(key)) {
      err.textContent = raw ? '这串不像找回码，检查一下有没有复制全' : '先把找回码粘进来';
      return;
    }
    err.textContent = '';

    var cur = WL.me.key();
    if (cur === key) { renderRoomPicker(); return; }

    var btn = $('#restoreBtn');
    btn.disabled = true;
    btn.textContent = '正在找回…';

    // 这台设备当前那把钥匙可能自己也攒了一些房间。
    // 直接换钥匙的话那些房间就孤立了，所以先问要不要并过来。
    WL.me.countMembers(cur).then(function (n) {
      if (!n) return 0;
      var ok = confirm(
        '这台设备现在的身份下还有 ' + n + ' 个房间。\n\n' +
        '要把它们并到找回码这个身份吗？\n' +
        '合并后所有房间归同一个找回码管，以后换设备一次就能全拿回来。\n\n' +
        '（只有确认这两个身份都是你本人时才合并）');
      return ok ? WL.me.merge(cur, key) : 0;
    }).then(function (moved) {
      WL.me.adopt(key);
      btn.disabled = false;
      btn.textContent = '找回我的房间';
      $('#restoreBox').hidden = true;
      $('#restoreInput').value = '';
      renderRoomPicker();
      if (moved) {
        setTimeout(function () { alert('已合并 ' + moved + ' 个房间的身份。'); }, 400);
      }
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '找回我的房间';
      err.textContent = '找回失败：' + e.message;
    });
  }

  function createRoom() {
    var name = $('#newRoomName').value.trim();
    if (!name) { $('#roomErr').textContent = '给房间起个名字，比如「和小林」'; return; }
    $('#roomErr').textContent = '';
    $('#createRoomBtn').disabled = true;
    WL.rooms.create(name).then(function (room) {
      location.search = '?r=' + encodeURIComponent(room.code);
    }).catch(function (e) {
      $('#createRoomBtn').disabled = false;
      $('#roomErr').textContent = e.message;
    });
  }

  /* ---------- 成员管理 ---------- */

  function memberStats(m) {
    var items = store.getState().items;
    var added = 0, watched = 0, said = 0;
    items.forEach(function (i) {
      if (i.added_by === m.id) added++;
      if (i.watchers.indexOf(m.id) >= 0) watched++;
      (i.comments || []).forEach(function (c) { if (c.member_id === m.id) said++; });
    });
    return { added: added, watched: watched, said: said,
             total: added + watched + said };
  }

  function renderMembers() {
    var st = store.getState();
    $('#memberList').innerHTML = st.members.map(function (m) {
      var s = memberStats(m);
      var isMe = m.id === st.meId;
      return '<div class="member-row">' +
        avatarMarkup(m.avatar, m.name, colorFor(m.id), 36) +
        '<span class="m-info">' +
          '<span class="m-name">' + esc(m.name) + (isMe ? '<em>（这是我）</em>' : '') + '</span>' +
          '<span class="m-stat">' + (s.total
            ? '加了 ' + s.added + ' 条 · 打勾 ' + s.watched + ' · 评论 ' + s.said
            : '还没有任何记录') + '</span>' +
        '</span>' +
        '<button class="m-remove" data-id="' + esc(m.id) + '">' +
          (isMe ? '退出' : '移除') + '</button>' +
      '</div>';
    }).join('');

    $('#memberList').querySelectorAll('.m-remove').forEach(function (b) {
      b.addEventListener('click', function () { confirmRemove(b.dataset.id); });
    });
    $('#members').hidden = false;
  }

  function confirmRemove(id) {
    var st = store.getState();
    var m = memberById(id);
    if (!m) return;
    var s = memberStats(m);
    var isMe = id === st.meId;

    var msg = isMe
      ? '退出「' + st.room.name + '」？\n\n这台设备会忘掉这个房间，你打过的勾和评论会一起删掉。想回来的话，重新打开邀请链接就行。'
      : s.total
        ? '移除「' + m.name + '」？\n\n他打的 ' + s.watched + ' 个勾和 ' + s.said +
          ' 条评论会一起删掉。\n他加的 ' + s.added + ' 条视频会保留，但署名变成「已退出」。'
        : '移除「' + m.name + '」？\n\n他没有任何记录，不会丢内容。';

    if (!confirm(msg)) return;

    store.removeMember(id).then(function () {
      if (isMe) {
        WL.rooms.forget(st.room.code);
        location.href = '?';
        return;
      }
      renderMembers();
      render();
    }).catch(function (e) { alert('移除失败：' + e.message); });
  }

  /* ---------- 提醒开关 ---------- */

  function renderNotify() {
    var box = $('#notifyBox'), txt = $('#notifyText'), btn = $('#notifyBtn');
    var st = WL.push.state();

    box.hidden = false;
    btn.hidden = true;
    btn.disabled = false;

    if (st === 'unsupported' || st === 'unconfigured') { box.hidden = true; return; }

    if (st === 'needs-install') {
      // iOS 只给主屏幕应用推送，Safari 标签页里连 API 都没有
      txt.textContent = '想收提醒的话：先用 Safari 的「分享 → 添加到主屏幕」，再从主屏幕那个图标里打开这一页。';
      return;
    }
    if (st === 'blocked') {
      txt.textContent = '通知被系统挡住了。去「设置 → 通知 → 共享待看」里打开，再回来试。';
      return;
    }

    WL.push.isSubscribed().then(function (on) {
      if (on) {
        txt.textContent = '朋友加了新东西时会提醒你。';
        btn.textContent = '关掉提醒';
        btn.hidden = false;
        btn.onclick = function () {
          btn.disabled = true;
          btn.textContent = '正在关…';
          WL.push.disable().then(renderNotify).catch(function (e) {
            txt.textContent = '关不掉：' + e.message;
            renderNotify();
          });
        };
      } else {
        txt.textContent = '想在朋友加了新视频时收到提醒吗？';
        btn.textContent = '开启提醒';
        btn.hidden = false;
        btn.onclick = function () {
          btn.disabled = true;
          btn.textContent = '正在开…';
          // 必须由这次点击直接触发，不能放进异步回调里再问
          WL.push.enable(navigator.userAgent.slice(0, 60)).then(function () {
            renderNotify();
          }).catch(function (e) {
            txt.textContent = e.message;
            renderNotify();
          });
        };
      }
    });
  }

  /* ---------- 邀请 ---------- */

  function inviteLink() {
    return location.origin + location.pathname + '?r=' + store.getState().room.code;
  }

  function copyInvite() {
    var link = inviteLink();
    var done = function () {
      var b = $('#inviteBtn');
      b.textContent = '链接已复制';
      setTimeout(function () { b.textContent = '邀请'; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { prompt('复制这个链接发给朋友：', link); });
    } else {
      prompt('复制这个链接发给朋友：', link);
    }
  }

  /* ---------- 粘贴解析 ---------- */

  function handlePaste() {
    var raw = $('#pasteBox').value;
    var err = $('#pasteErr');
    var r = WL.parse.parseShareText(raw);
    if (!r) {
      pending = null;
      $('#preview').hidden = true;
      err.textContent = raw.trim() ? '没找到链接，检查一下粘贴的内容' : '';
      return;
    }
    err.textContent = '';
    pending = r;
    $('#preview').hidden = false;
    $('#previewBadge').textContent = r.platform.name;
    $('#previewBadge').style.background = r.platform.color;
    $('#previewUrl').textContent = r.url;
    $('#titleInput').value = r.title || '';
    $('#titleInput').placeholder = r.title ? '' : '这条没自动认出标题，手动写一句';
  }

  function submitItem() {
    var err = $('#pasteErr');
    if (!pending) { err.textContent = '先粘贴一个链接'; return; }
    var title = $('#titleInput').value.trim();
    if (!title) { err.textContent = '给它起个名字，不然以后认不出来'; $('#titleInput').focus(); return; }
    err.textContent = '';
    store.addItem({ url: pending.url, title: title, platform: pending.platform.id });
    pending = null;
    $('#pasteBox').value = '';
    $('#titleInput').value = '';
    $('#preview').hidden = true;
    tab = 'todo';
  }

  /* ---------- 列表 ---------- */

  function isDone(item) { return !!item.archived_at; }

  function itemHtml(item) {
    var p = platformInfo(item.platform);
    var meId = store.getState().meId;
    var members = store.getState().members;
    var done = isDone(item);
    var iWatched = item.watchers.indexOf(meId) >= 0;
    var others = members.filter(function (m) { return m.id !== meId; });
    var waiting = !done && !iWatched && others.length &&
                  others.every(function (m) { return item.watchers.indexOf(m.id) >= 0; });

    // 别人的进度用一排小头像表示，看过的亮着
    var dots = others.map(function (m) {
      var seen = item.watchers.indexOf(m.id) >= 0;
      return '<span class="who'+(seen?' seen':'')+'" title="'+esc(m.name)+(seen?' 看过了':' 还没看')+'">' +
        avatarMarkup(m.avatar, m.name, colorFor(m.id), 20) + '</span>';
    }).join('');

    var comments = (item.comments || []).map(function (c) {
      return '<div class="comment">' + avatarOf(c.member_id, 20) +
        '<span class="c-body"><span class="c-who">'+esc(nameOf(c.member_id))+'</span>' +
        '<span class="c-text">'+esc(c.text)+'</span></span></div>';
    }).join('');

    return '<article class="card'+(done?' done':'')+'" data-id="'+esc(item.id)+'">' +
      '<div class="card-top">' +
        '<span class="badge" style="background:'+p.color+'">'+esc(p.name)+'</span>' +
        '<a class="title" href="'+esc(item.url)+'" target="_blank" rel="noopener">'+esc(item.title)+'</a>' +
        '<button class="icon-btn" data-act="del" aria-label="删除">✕</button>' +
      '</div>' +
      '<div class="meta">' + avatarOf(item.added_by, 16) +
        '<span>'+esc(nameOf(item.added_by))+' 添加 · '+esc(timeAgo(item.created_at))+'</span>' +
        (waiting ? '<span class="nudge">就等你了</span>' : '') +
      '</div>' +
      '<div class="checks">' +
        '<label class="check'+(iWatched?' on':'')+'">' +
          '<input type="checkbox" data-act="watch"'+(iWatched?' checked':'')+'><span>我看了</span>' +
        '</label>' +
        (dots ? '<span class="whos">'+dots+'</span>' : '') +
      '</div>' +
      (comments ? '<div class="comments">'+comments+'</div>' : '') +
      '<div class="comment-add"><input type="text" data-act="comment" placeholder="留个想法…" maxlength="500"></div>' +
    '</article>';
  }

  function render() {
    var st = store.getState();
    var todo = st.items.filter(function (i) { return !isDone(i); });
    var done = st.items.filter(isDone);
    var list = tab === 'todo' ? todo : done;

    $('#roomTitle').textContent = st.room.name || '未命名房间';
    $('#memberStrip').innerHTML = st.members.map(function (m) {
      return '<span class="member" title="'+esc(m.name)+'">'+
        avatarMarkup(m.avatar, m.name, colorFor(m.id), 22)+'</span>';
    }).join('') + '<span class="member-count">'+st.members.length+' 人 ›</span>';

    var me = store.me();
    $('#meChip').innerHTML = me
      ? avatarMarkup(me.avatar, me.name, colorFor(me.id), 22) +
        '<span>'+esc(me.name)+'</span><span class="chip-edit" aria-hidden="true">改</span>'
      : '';

    $('#tabTodo').textContent = '待看 ' + todo.length;
    $('#tabDone').textContent = '已完成 ' + done.length;
    $('#tabTodo').classList.toggle('active', tab === 'todo');
    $('#tabDone').classList.toggle('active', tab === 'done');

    if (st.members.length < 2) {
      $('#soloHint').hidden = false;
      $('#soloHint').innerHTML = '房间里还只有你一个人。' +
        '<button class="link-btn" id="soloInvite">复制邀请链接</button>发给朋友，' +
        '他加进来之后才会开始算「都看过了」。';
      $('#soloInvite').addEventListener('click', copyInvite);
    } else {
      $('#soloHint').hidden = true;
    }

    $('#list').innerHTML = list.length
      ? list.map(itemHtml).join('')
      : '<p class="empty">' + (tab === 'todo'
          ? '清单是空的。把链接粘到上面，就进队列了。'
          : '还没有所有人都看完的。') + '</p>';

    bindItemEvents();
  }

  function bindItemEvents() {
    $('#list').querySelectorAll('.card').forEach(function (card) {
      var id = card.dataset.id;
      var cb = card.querySelector('input[data-act="watch"]');
      if (cb) cb.addEventListener('change', function () { store.toggleWatched(id); });

      var del = card.querySelector('[data-act="del"]');
      if (del) del.addEventListener('click', function () {
        if (confirm('删掉这条？评论也会一起消失。')) store.deleteItem(id);
      });

      var input = card.querySelector('input[data-act="comment"]');
      if (input) input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var t = input.value.trim();
        if (!t) return;
        input.value = '';
        store.addComment(id, t);
      });
    });
  }

  /* ---------- 启动 ---------- */

  function fail(msg) {
    $('#errorText').textContent = msg;
    showScreen('#screenError');
  }

  function bindChrome() {
    $('#pasteBox').addEventListener('input', handlePaste);
    $('#addBtn').addEventListener('click', submitItem);
    $('#titleInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitItem(); });
    $('#tabTodo').addEventListener('click', function () { tab = 'todo'; render(); });
    $('#tabDone').addEventListener('click', function () { tab = 'done'; render(); });
    $('#meChip').addEventListener('click', function () { openEditor('edit'); });
    $('#memberStrip').addEventListener('click', renderMembers);
    $('#membersClose').addEventListener('click', function () { $('#members').hidden = true; });
    $('#members').addEventListener('mousedown', function (e) {
      if (e.target === $('#members')) $('#members').hidden = true;
    });
    $('#inviteBtn').addEventListener('click', copyInvite);
    $('#createRoomBtn').addEventListener('click', createRoom);
    $('#newRoomName').addEventListener('keydown', function (e) { if (e.key === 'Enter') createRoom(); });
    $('#joinBtn').addEventListener('click', function () { openEditor('join'); });
    $('#copyMyLink').addEventListener('click', copyMyLink);
    $('#showRestore').addEventListener('click', function () {
      var box = $('#restoreBox');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#restoreInput').focus();
    });
    $('#restoreBtn').addEventListener('click', restoreRooms);
    $('#restoreInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') restoreRooms();
    });

    $('#editorSave').addEventListener('click', saveEditor);
    $('#editorCancel').addEventListener('click', closeEditor);
    // mousedown 而不是 click：否则打开弹层的那一次点击抬手时会顺手关掉它
    $('#editor').addEventListener('mousedown', function (e) {
      if (e.target === $('#editor')) closeEditor();
    });
    $('#nameInput').addEventListener('input', function () {
      if (!draft) return;
      draft.name = $('#nameInput').value;
      if (!draft.avatar) renderEditor();
    });
    $('#nameInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveEditor(); });
    $('#clearAvatar').addEventListener('click', function () {
      if (draft) { draft.avatar = ''; renderEditor(); }
    });
    $('#photoInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      $('#editorErr').textContent = '';
      fileToAvatar(f).then(function (uri) { draft.avatar = uri; renderEditor(); })
        .catch(function (err) { $('#editorErr').textContent = err.message; });
      e.target.value = '';
    });
  }

  function boot() {
    bindChrome();

    // ?me=xxx 是找回链接：认下钥匙就把它从地址栏抹掉，别留在历史记录里
    var meKey = new URLSearchParams(location.search).get('me');
    if (meKey) {
      WL.me.adopt(meKey);
      history.replaceState(null, '', location.pathname);
    }

    var code = roomCodeFromUrl();
    if (!code) { renderRoomPicker(); return; }

    WL.rooms.open(code).then(function (s) {
      store = s;
      return s.init().then(function () {
        s.onChange(function () {
          if (!$('#app').hidden) render();
        });
        if (!s.me()) {
          renderJoinScreen();
        } else {
          s.adoptIfOrphan();
          showScreen('#app');
          render();
        }
      });
    }).catch(function (e) { fail(e.message); });
  }

  boot();
})(window.WL = window.WL || {});
