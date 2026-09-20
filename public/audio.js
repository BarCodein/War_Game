// public/audio.js — 统一 UI / 设备音效播放工具（普通脚本，挂 window 全局）
//
// 用法：
//   window.playSfx('click')                      播放指定音效
//   window.bindSfx('.home-card', 'click')        给选择器批量绑定点击音效
//   window.bindSfx({ '.home-card':'click', '#logoutButton':'shutdown' })
//
// 音效文件位于 assets/audio/，通过 Vite 的 /assets/** 提供（dev 与 build 一致）。
// 仅覆盖「设备 / UI 交互」音效；局内战斗音效（枪声/爆炸/死亡等）不在此处。
(function () {
  'use strict';

  var BASE = '/assets/audio/';

  // 设备 / UI 音效表（名称 → 文件名）
  var SFX = {
    click: 'click.mp3',             // 通用点击（链接 / 卡片）
    tap: 'tap.mp3',                 // 轻点
    mouseClick: 'mouse_click.mp3',  // 鼠标单击
    button: 'button_press.mp3',     // 按钮按下
    toggle: 'button_toggle.mp3',    // 开关 / 标签切换
    slide: 'slide.mp3',             // 滑动切换
    loading: 'loading.mp3',         // 加载中
    startup: 'startup.mp3',         // 开机 / 进入
    shutdown: 'shutdown.mp3',       // 关机 / 退出
    // 战斗音效：目前**没有页面在播**——局内的"单位接触战斗音"和"单位阵亡音"
    // 已按需求从 hud.js 移除，这里保留映射与素材，需要时在 hud.js 里重新触发即可。
    blade: 'blade.mp3',             // 短兵相接（原：进入白刃战时播一次）
    hurt: 'hurt.mp3',               // 敌军被击败（原：有单位阵亡时播一次）
    gunshot: 'gunshot.mp3',         // 远距射击（预留）
    explosion: 'explosion.mp3'      // 爆炸（预留）
  };

  // Chrome 标签自动播放策略：未与页面交互前整个 tab 静音，连带 <audio> 静默失败。
  // 解决：在所有按钮/链接的 click 上把"已经和页面交互"标记下来，
  //       play() 时如果是首次播放并且未交互，先用一个 muted 的 Audio 探针播一下解锁。
  // 这样不需要在 document 全局监听 mousedown 之类的副作用。
  var interacted = false;
  var cache = {};
  var probe = null;

  function ensureUnlocked() {
    if (interacted) return;
    try {
      if (!probe) {
        probe = new Audio(BASE + SFX.tap);
        probe.muted = true;
        probe.volume = 0;
      }
      var p = probe.play();
      if (p && typeof p.then === 'function') {
        p.then(function () { probe.pause(); }).catch(function () {});
      }
    } catch (e) {}
  }

  function play(name, volume) {
    try {
      var file = SFX[name];
      if (!file) return;
      if (!cache[file]) {
        cache[file] = new Audio(BASE + file);
      }
      var audio = cache[file];
      audio.volume = (typeof volume === 'number') ? volume : 1;
      // 快速连点时从头重播
      try { audio.currentTime = 0; } catch (e) {}
      var p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {
      // 静默失败（浏览器自动播放策略 / 文件缺失）
    }
  }

  // 便捷批量绑定：bindSfx(selector, name) 或 bindSfx({ selector: name })
  function bindSfx(selectorOrMap, sfxName, root) {
    root = root || document;
    function on(sel, name) {
      var els = root.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        els[i].addEventListener('click', function () {
          interacted = true; // 任何被 bindSfx 绑过的按钮被点都算"已交互"
          play(name);
        });
      }
    }
    if (typeof selectorOrMap === 'string') {
      on(selectorOrMap, sfxName);
    } else {
      for (var sel in selectorOrMap) {
        if (Object.prototype.hasOwnProperty.call(selectorOrMap, sel)) {
          on(sel, selectorOrMap[sel]);
        }
      }
    }
  }

  // 在 capture 阶段监听任意 click/pointerdown/keydown：标记已交互 + 解锁。
  // 一次性的，触发后立刻移除监听器。
  function markInteracted() {
    interacted = true;
    ensureUnlocked();
    document.removeEventListener('click', markInteracted, true);
    document.removeEventListener('pointerdown', markInteracted, true);
    document.removeEventListener('keydown', markInteracted, true);
    document.removeEventListener('touchstart', markInteracted, true);
  }
  document.addEventListener('click', markInteracted, true);
  document.addEventListener('pointerdown', markInteracted, true);
  document.addEventListener('keydown', markInteracted, true);
  document.addEventListener('touchstart', markInteracted, true);

  window.playSfx = play;
  window.bindSfx = bindSfx;
  window.SFX_FILES = SFX;
  window.__audioInteracted = function () { return interacted; }; // 给调试用
})();
