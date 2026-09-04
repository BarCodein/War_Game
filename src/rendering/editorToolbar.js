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

const SIZE_PRESETS = { '1280x720': [1280, 720], '1920x1080': [1920, 1080], '960x540': [960, 540] };

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

  function syncStatus() {
    const errors = store.errors();
    if (errors.length > 0) setStatus(`⚠ ${t('editor.status.invalid')}：${errors.join('；')}`, true);
    else setStatus(t('editor.status.valid'));
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
      callbacks.onToolChange?.(tool);
      return;
    }
    if (!action) return;
    switch (action) {
      case 'new':
        dialog.hidden = false;
        nameInput.value = store.mapData.name;
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
