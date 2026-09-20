// public/bgm-controller.js — 非游玩页面的 BGM 注入与控件
//
// 每个非游玩页面在 audio.js 之后引入本脚本：
//   <script src="/audio.js"></script>
//   <script src="/bgm-controller.js"></script>
//
// 自动行为：
// 1. 在 body 末尾插入一个 0×0 不可见 iframe（指向 /bgm.html）
// 2. 在右下角注入一个固定的播放/暂停按钮（.bgm-control）
// 3. iframe 加载后立即给它发 start（unmute + play），让用户进页面就听到 BGM
//    ——bgm.html 的 audio 元素默认 muted=true，autoplay 一定成功；
//    一旦收到 start 就 unmute + play，用户就听到声音
// 4. 按钮点击：toggle 播放/暂停
// 【修改需求】一旦播放过场视频，BGM暂停，视频结束后不再恢复BGM
(function () {
  'use strict';
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
    // 本页想要哪首 BGM：页面可在引入本脚本前设置 window.BGM_SONG，
    // 默认《江山如此多娇》。game / battlebackground 等页面会设为《在太行山上》。
    var song = (window.BGM_SONG || 'jiangshanruciduojiao').replace(/[^a-zA-Z0-9_-]/g, '');
    // 续播进度按「歌曲」分别存储，避免不同歌之间错位续播
    var storageKey = 'war-of-dots.bgm.' + song;
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
    var initialPaused = false;
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && saved.paused) initialPaused = true;
    } catch (e) {}
    updateBtn(btn, initialPaused);
    // iframe 加载完成后：给 iframe 发 start（unmute + play）。
    // 这是关键：bgm.html 的 audio 默认 muted=true，autoplay 一定成功；
    // 一旦父页面发 start 把它 unmute，用户进页面就听到声音。
    function sendStart() {
      try { frame.contentWindow.postMessage({ cmd: 'start' }, '*'); } catch (e) {}
    }
    frame.addEventListener('load', sendStart);
    // 兜底：如果 iframe 已经 load 完了（罕见），再发一次
    setTimeout(sendStart, 100);
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
