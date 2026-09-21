// public/bgm-controller.js — 非游玩页面的 BGM 注入与控件
//
// 每个非游玩页面在 audio.js 之后引入本脚本：
//   <script src="/audio.js"></script>
//   <script src="/bgm-controller.js"></script>
//
// 自动行为：
// 1. 在 body 末尾插入一个 0×0 不可见 iframe（指向 /bgm.html?song=<曲目>）
// 2. 在右下角注入一个固定的播放/暂停按钮（.bgm-control）
// 3. iframe 加载后给它发 start（unmute + play），让用户进页面就听到 BGM
//    ——bgm.html 的 audio 元素默认 muted=true，autoplay 一定成功；
//    一旦收到 start 就 unmute + play，用户就听到声音。
//    用户显式关过 BGM（war-of-dots.bgm.<曲目>.paused）时不发，保持安静。
// 4. 按钮点击：toggle 播放/暂停
// 【修改需求】一旦播放过场视频，BGM暂停，视频结束后不再恢复BGM
//
// 曲目怎么定（见 resolveSong）：
//   · 页面显式 window.BGM_SONG 优先（game / battlebackground / loading 用《在太行山上》，
//     结局页用钢琴曲 piano_string）；
//   · 没显式指定时：**全战役通关（打完渡江）后换成钢琴曲**，否则《江山如此多娇》。
//
// 页面还可以设 window.BGM_AUTOSTART = false：此时不在加载时就起播，
// 由页面自己调 window.BgmStart()（结局页就是等视频播完 / 被跳过之后才放）。
(function () {
  'use strict';

  var DEFAULT_SONG = 'jiangshanruciduojiao';
  var CLEARED_SONG = 'piano_string';   // 全战役通关后的默认曲目
  var CLEARED_LEVEL = 'dujiang_battle'; // 与 result.html / ending.html 的结局关卡同一口径
  var SESSION_KEY = 'war-of-dots.session';
  var KEY_PREFIX = 'war-of-dots.u.';
  var GUEST_USER = 'guest';

  function sanitizeSong(name) {
    return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  }

  // 当前账号（与 public/user-storage.js 同一套规则；只有一部分页面加载了它，所以这里自带一份）
  function normalizeUser(name) {
    var raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
    var safe = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || GUEST_USER;
  }

  function accountUser() {
    try {
      var session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return normalizeUser(session && session.username);
    } catch (e) {
      return GUEST_USER;
    }
  }

  function readAccountJSON(name, fallback) {
    // 页面自己装了存储层就用它（同一套规则），否则按同样的键规则直接读
    if (window.UserStorage && window.UserStorage.readJSON) {
      return window.UserStorage.readJSON(name, fallback);
    }
    try {
      var raw = localStorage.getItem(KEY_PREFIX + accountUser() + '.' + name);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 全战役通关了没有（口径 = 打完渡江，也就是能进结局页的那一关） */
  function campaignCleared() {
    var progress = readAccountJSON('campaign-progress', {}) || {};
    return !!(progress[CLEARED_LEVEL] && progress[CLEARED_LEVEL].completed);
  }

  /** 本页该放哪首：显式指定 > 通关状态 */
  function resolveSong() {
    if (window.BGM_SONG) return sanitizeSong(window.BGM_SONG);
    return campaignCleared() ? CLEARED_SONG : DEFAULT_SONG;
  }

  function savedPaused(storageKey) {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return !!(saved && saved.paused);
    } catch (e) {
      return false;
    }
  }

  function injectStyle() {
    if (document.getElementById('bgm-controller-style')) return;
    var s = document.createElement('style');
    s.id = 'bgm-controller-style';
    s.textContent =
      '.bgm-frame{position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none}' +
      '.bgm-control{position:fixed;right:18px;bottom:18px;z-index:100;display:inline-block;box-sizing:border-box;width:26px;height:26px;padding:0;border-radius:13px;border:1px solid #4a2f12;background:linear-gradient(180deg,#d4b67c 0%,#a37b3a 100%);color:#2b1d12;font-size:13px;font-weight:700;line-height:24px;text-align:center;font-family:"Microsoft YaHei",sans-serif;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),inset 0 -2px 4px rgba(0,0,0,.3),0 2px 6px rgba(0,0,0,.5);transition:transform .12s,box-shadow .12s}' +
      '.bgm-control:hover{background:linear-gradient(180deg,#e0c08a 0%,#b08840 100%);transform:scale(1.04);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 4px 10 rgba(0,0,0,.6)}' +
      '.bgm-control.is-paused{background:linear-gradient(180deg,#8b7a5a 0%,#5a4a2a 100%);color:#f1e3c4}';
    document.head.appendChild(s);
  }
  function inject() {
    // 本页想要哪首 BGM：页面显式指定优先；否则按"是否全战役通关"解析（见 resolveSong）
    var song = resolveSong();
    // 续播进度按「歌曲」分别存储，避免不同歌之间错位续播
    var storageKey = 'war-of-dots.bgm.' + song;
    // 是否在 iframe 加载时就起播（页面可设 window.BGM_AUTOSTART = false 自己控制时机）
    var autoStart = window.BGM_AUTOSTART !== false;
    // 不可见 iframe（?song= 指定播放的歌曲）
    var frame = document.createElement('iframe');
    frame.src = '/bgm.html?song=' + encodeURIComponent(song);
    frame.className = 'bgm-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    document.body.appendChild(frame);
    // 右下角控件
    var btn = document.createElement('button');
    btn.className = 'bgm-control is-paused';
    btn.type = 'button';
    btn.title = '背景音乐';
    btn.setAttribute('aria-label', '背景音乐 播放/暂停');
    document.body.appendChild(btn);
    // 初始状态：从 localStorage 读，决定按钮视觉
    updateBtn(btn, savedPaused(storageKey));
    // iframe 加载完成后：给 iframe 发 start（unmute + play）。
    // 这是关键：bgm.html 的 audio 默认 muted=true，autoplay 一定成功；
    // 一旦父页面发 start 把它 unmute，用户进页面就听到声音。
    // 两种情况不发：本页要求手动起播（BGM_AUTOSTART=false）、或用户显式关过 BGM。
    function post(msg) {
      try { frame.contentWindow.postMessage(msg, '*'); } catch (e) {}
    }
    function sendStart() {
      if (!autoStart) return;
      if (savedPaused(storageKey)) return;
      post({ cmd: 'start' });
    }
    frame.addEventListener('load', sendStart);
    // 兜底：如果 iframe 已经 load 完了（罕见），再发一次
    setTimeout(sendStart, 100);
    // 页面自己起播（结局页：视频播完 / 被跳过之后）。返回值表示到底放没放。
    window.BgmStart = function () {
      if (savedPaused(storageKey)) return false;
      post({ cmd: 'start' });
      updateBtn(btn, false);
      return true;
    };
    // 过场视频接管：一旦视频播放，暂停BGM；视频结束**不再恢复BGM**
    monitorVideos(frame, storageKey);
    // 按钮点击：toggle
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { frame.contentWindow.postMessage({ cmd: 'toggle' }, '*'); } catch (e) {}
      // 乐观更新 UI（不阻塞）
      var paused;
      try {
        var s = JSON.parse(localStorage.getItem(storageKey) || 'null');
        paused = s ? !!s.paused : false;
      } catch (err) { paused = false; }
      updateBtn(btn, !paused);
    });
    // 接收 iframe 反馈的播放状态
    window.addEventListener('message', function (e) {
      if (!e.data) return;
      if (e.data.cmd === 'status') {
        updateBtn(btn, !!e.data.paused);
      }
    });
  }
  function updateBtn(btn, paused) {
    if (paused) {
      btn.classList.add('is-paused');
      btn.textContent = '\u25B6'; // ▶ 播放
      btn.title = '背景音乐（已暂停，点击播放）';
    } else {
      btn.classList.remove('is-paused');
      btn.textContent = '\u23F8'; // ⏸ 暂停
      btn.title = '背景音乐（播放中，点击暂停）';
    }
  }
  /* =========================================================
   monitorVideos — 过场视频与 BGM 的互斥桥
   修改后规则：视频开始播放，直接暂停BGM；视频结束/暂停，**不再恢复BGM**
  ========================================================= */
  function monitorVideos(frame, storageKey) {
    var STORAGE_KEY = storageKey || 'war-of-dots.bgm';
    function pauseBgm() {
      try { frame.contentWindow.postMessage({ cmd: 'pause' }, '*'); } catch (e) {}
    }
    function bindVideo(v) {
      if (!v || v.__bgmVideoBound) return;
      v.__bgmVideoBound = true;
      v.addEventListener('play', function () {
        // 只要视频开始播放，直接暂停BGM，视频结束不再恢复
        pauseBgm();
      });
      // 绑定瞬间视频已在播放（脚本晚于 video.play 执行）：立即补一次暂停
      if (!v.paused && !v.ended) {
        pauseBgm();
      }
    }
    // 现有 video
    var existing = document.querySelectorAll('video');
    Array.prototype.forEach.call(existing, bindVideo);
    // 后续动态插入的 video
    if (window.MutationObserver) {
      var obs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes || [], function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'VIDEO') bindVideo(n);
            else if (n.querySelectorAll) {
              Array.prototype.forEach.call(n.querySelectorAll('video'), bindVideo);
            }
          });
        });
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  // 暴露给页面脚本与单测：曲目解析 + 手动起播（window.BgmStart 在 inject 里挂上）
  window.BgmController = {
    DEFAULT_SONG: DEFAULT_SONG,
    CLEARED_SONG: CLEARED_SONG,
    CLEARED_LEVEL: CLEARED_LEVEL,
    sanitizeSong: sanitizeSong,
    normalizeUser: normalizeUser,
    accountUser: accountUser,
    campaignCleared: campaignCleared,
    resolveSong: resolveSong,
    savedPaused: savedPaused,
    /** 本页最终会用哪首（inject 跑过之后才准确；没跑时按当前配置解析） */
    song: function () { return resolveSong(); },
  };

  if (document.body) {
    injectStyle();
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      injectStyle();
      inject();
    });
  }
})();
