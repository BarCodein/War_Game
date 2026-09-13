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
    shutdown: 'shutdown.mp3'        // 关机 / 退出
  };

  var cache = {};

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
        els[i].addEventListener('click', function () { play(name); });
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

  window.playSfx = play;
  window.bindSfx = bindSfx;
  window.SFX_FILES = SFX;
})();
