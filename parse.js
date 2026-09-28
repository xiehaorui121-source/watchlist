/* 从分享文本里解析出链接、平台和标题。
   各家 App 的「复制链接」给的都是一整段话，格式相对稳定，
   所以标题基本能白嫖出来，不需要调任何接口。 */
(function (WL) {
  'use strict';

  var PLATFORMS = [
    { id: 'bilibili', name: '哔哩哔哩', hosts: ['bilibili.com', 'b23.tv'], color: '#FB7299' },
    { id: 'xiaohongshu', name: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'], color: '#FF2442' },
    { id: 'douyin', name: '抖音', hosts: ['douyin.com', 'iesdouyin.com'], color: '#7B5CFF' },
    { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], color: '#FF0000' },
    { id: 'zhihu', name: '知乎', hosts: ['zhihu.com', 'zhuanlan.zhihu.com'], color: '#0084FF' },
    { id: 'weixin', name: '公众号', hosts: ['mp.weixin.qq.com'], color: '#07C160' },
    { id: 'weibo', name: '微博', hosts: ['weibo.com', 'weibo.cn'], color: '#E6162D' },
    { id: 'podcast', name: '小宇宙', hosts: ['xiaoyuzhoufm.com'], color: '#C8B6FF' }
  ];

  var OTHER = { id: 'other', name: '链接', hosts: [], color: '#888780' };

  // 分享文本里的固定话术，提取标题前先剃掉
  var BOILERPLATE = [
    /^\s*[\d.]+\s*/,
    /复制打开小红书[，,]?\s*看看/g,
    /复制打开抖音[，,]?\s*看看/g,
    /复制本条信息[，,]?\s*打开[【「].*?[】」]\s*App\s*查看精彩内容[！!]?/g,
    /点击链接直接打开/g,
    /[-—\s]*哔哩哔哩\s*bilibili/gi,
    /[-—\s]*哔哩哔哩/g,
    /[|｜]\s*小红书\s*[-—]\s*你的生活指南/g,
    /[-—\s]*知乎/g,
    /的?作品\s*$/g,
    /[，,]\s*$/
  ];

  var URL_RE = /https?:\/\/[^\s，,。）)】」"'"、]+/;

  function detectPlatform(url) {
    var host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch (e) {
      return OTHER;
    }
    for (var i = 0; i < PLATFORMS.length; i++) {
      var p = PLATFORMS[i];
      for (var j = 0; j < p.hosts.length; j++) {
        if (host === p.hosts[j] || host.endsWith('.' + p.hosts[j])) return p;
      }
    }
    return OTHER;
  }

  function clean(text) {
    var out = text || '';
    BOILERPLATE.forEach(function (re) { out = out.replace(re, ' '); });
    // 去掉常见的表情符号和多余空白
    out = out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();
    out = out.replace(/^[，,、\-—|｜]+|[，,、\-—|｜]+$/g, '').trim();
    return out;
  }

  /* 输入：用户粘贴的一整段分享文本
     输出：{ url, platform, title }  —— title 可能为空，交给用户手填 */
  function parseShareText(raw) {
    var text = (raw || '').trim();
    if (!text) return null;

    var m = text.match(URL_RE);
    var url = m ? m[0] : null;

    // 没有 http 前缀但看着像域名，也认
    if (!url) {
      var bare = text.match(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*)/i);
      if (bare) url = 'https://' + bare[1];
    }
    if (!url) return null;

    // B站和小红书把标题放在【】里；抖音放的是「某某的作品」，真标题在括号外面。
    var title = '';
    var bracket = text.match(/[【「]([^】」]{2,})[】」]/);
    var outside = clean(text.replace(URL_RE, ' ').replace(/[【「][^】」]*[】」]/, ' '));

    if (bracket) {
      var inside = clean(bracket[1]);
      title = (/的作品$/.test(bracket[1]) || !inside) ? (outside || inside) : inside;
    } else {
      title = outside;
    }

    // 标题要是把链接本身抄了一遍，不如留空让用户写
    if (/^(https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(title)) title = '';
    if (title.length > 80) title = title.slice(0, 80).trim() + '…';

    return { url: url, platform: detectPlatform(url), title: title };
  }

  WL.parse = {
    parseShareText: parseShareText,
    detectPlatform: detectPlatform,
    PLATFORMS: PLATFORMS,
    OTHER: OTHER
  };
})(window.WL = window.WL || {});
