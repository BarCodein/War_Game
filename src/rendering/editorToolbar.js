import { t } from '../i18n/index.js';
import { createNewMap } from '../editor/editorStore.js';

// 编辑器工具栏（DOM）：保存/载入（localStorage）、导出（下载 JSON）、导入（文件 API）、
// 新建对话框、试玩入口与校验状态栏。操作只改 editorStore，画布刷新由 EditorScene 回调完成。

const STORAGE_KEY = 'war-of-dots.custom-map';

export function saveToStorage(mapData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), mapData }));
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).mapData : null;
  } catch {
    return null;
  }
}

// 尺寸预设：游戏画布固定 1280×800，比它小的地图会被编辑器补齐（见 editor/mapResize.js），
// 比它大的地图在游戏里只能看到左上部分（状态栏会提示）。
const SIZE_PRESETS = { '1280x800': [1280, 800], '1920x1080': [1920, 1080] };

export function createEditorToolbar(scene, store, callbacks = {}) {
  const toolbar = document.querySelector('#editorToolbar');
  const statusEl = document.querySelector('#editorStatus');
  const dialog = document.querySelector('#newMapDialog');
  const nameInput = document.querySelector('#mapName');
  const sizeSelect = document.querySelector('#mapSize');
  const importFile = document.querySelector('#importFile');

  toolbar.hidden = false;
  // 文案走 i18n（index.html 中为静态占位文本）
  toolbar.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  nameInput.placeholder = t('editor.mapName');

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }

  // 新建对话框的尺寸下拉框要反映「地图目前尺寸」：
  // 预设之外的尺寸（例如导入的 1600×900）临时补一个选项，
  // 否则下拉框显示的尺寸与地图实际尺寸不一致，看起来像"可编辑尺寸不匹配"。
  const presetOptions = [...sizeSelect.options].map(option => option.value);
  function syncSizeSelect() {
    const { width, height } = store.mapData.size;
    const value = `${width}x${height}`;
    for (const option of [...sizeSelect.options]) {
      if (!presetOptions.includes(option.value)) option.remove(); // 清掉上一张自定义尺寸
    }
    if (!presetOptions.includes(value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${width} × ${height}`;
      sizeSelect.appendChild(option);
    }
    sizeSelect.value = value;
  }

  function syncStatus() {
    const errors = store.errors();
    // 状态栏始终带上「地图当前尺寸」：这一栏是判断"可编辑范围与画布是否一致"最直接的地方
    const { width, height } = store.mapData.size;
    if (errors.length > 0) {
      setStatus(`⚠ ${t('editor.status.invalid')}：${errors.join('；')}`, true);
      return;
    }
    // 大于画布的地图在游戏里只能看到左上 1280×800，提示一下（小于画布的地图已被编辑器补齐）
    if (width > scene.scale.width || height > scene.scale.height) {
      setStatus(`⚠ ${t('editor.status.largerThanCanvas')}（画布 ${scene.scale.width}×${scene.scale.height}）`, true);
      return;
    }
    setStatus(`${t('editor.status.valid')} · ${width}×${height}`);
  }

  function downloadMap(mapData) {
    const blob = new Blob([JSON.stringify(mapData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${mapData.name || 'map'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button, a');
    if (!button) return;
    const { action, tool } = button.dataset;
    if (tool) {
      window.playSfx?.('toggle');
      callbacks.onToolChange?.(tool);
      return;
    }
    if (!action) return;
    window.playSfx?.('button');
    switch (action) {
      case 'new':
        nameInput.value = store.mapData.name;
        syncSizeSelect(); // 下拉框先对齐当前地图尺寸
        dialog.hidden = false;
        break;
      case 'confirmNew': {
        const [width, height] = SIZE_PRESETS[sizeSelect.value];
        const name = nameInput.value.trim() || t('editor.defaultName');
        store.loadMapData(createNewMap(name, width, height));
        dialog.hidden = true;
        callbacks.onMapChange?.();
        syncStatus();
        break;
      }
      case 'cancelNew':
        dialog.hidden = true;
        break;
      case 'save':
        saveToStorage(store.mapData);
        setStatus(t('editor.status.saved'));
        break;
      case 'load': {
        const data = loadFromStorage();
        if (data) {
          store.loadMapData(data);
          callbacks.onMapChange?.();
          setStatus(t('editor.status.loaded'));
        } else {
          setStatus(t('editor.status.noSave'), true);
        }
        break;
      }
      case 'export':
        downloadMap(store.mapData);
        setStatus(t('editor.status.exported'));
        break;
      case 'play':
        if (store.errors().length > 0) {
          syncStatus();
          return;
        }
        callbacks.onPlay?.();
        break;
      default:
        break;
    }
  });

  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      store.loadMapData(data);
      callbacks.onMapChange?.();
      syncStatus();
    } catch {
      setStatus(t('editor.importError'), true);
    }
  });

  toolbar.querySelector('[data-action="import"]').addEventListener('click', () => importFile.click());

  return { setStatus, syncStatus };
}
