import { t } from '../i18n/index.js';
import { values } from '../config/index.js';

// HUD（DOM 实现，gdd.md §11 布局）：编队列表、城市状态、任务进度、事件日志、
// 顶栏控制与胜利结算。文案全部走 i18n；按 performance.hudRefreshMs 节流刷新。
export function createHud(scene, world, controller, selection, orders) {
  const els = {
    pauseButton: document.querySelector('#pauseButton'),
    speedButtons: document.querySelectorAll('[data-speed]'),
    exitPlaytest: document.querySelector('#exitPlaytest'),
    unitList: document.querySelector('#unitList'),
    unitCount: document.querySelector('#unitCount'),
    cityCard: document.querySelector('#cityCard'),
    selectionReadout: document.querySelector('#selectionReadout'),
    missionPanel: document.querySelector('#missionPanel'),
    missionList: document.querySelector('#missionList'),
    missionPercent: document.querySelector('#missionPercent'),
    missionProgress: document.querySelector('#missionProgress'),
    eventLog: document.querySelector('#eventLog'),
    toast: document.querySelector('#toast'),
    timer: document.querySelector('#timer'),
    coords: document.querySelector('#coords'),
    overlay: document.querySelector('#victoryOverlay'),
    overlayTitle: document.querySelector('#victoryTitle'),
    overlayDetail: document.querySelector('#victoryDetail'),
    restartButton: document.querySelector('#restartButton'),
  };

  const status = {
    obj2Done: false,
    obj3Done: false,
    obj4Done: false,
    victoryShown: false,
    lastEventIndex: 0,
    accumulator: 0,
  };

  // 顶部弹出的 toast 通知已移除（如「任务完成」）——相关进度只保留在右侧战场通讯日志。
  function showToast() {
    return;
  }

  // 顶栏
  els.pauseButton.addEventListener('click', () => controller.togglePause());
  for (const button of els.speedButtons) {
    button.addEventListener('click', () => controller.setSpeed(Number(button.dataset.speed)));
  }
  // 返回目标：编辑器试玩结束后安全返回编辑器（REQUIREMENTS.md §4.6），否则重开教学关
  function returnFromGame() {
    if (scene.fromEditor) {
      scene.scene.start('Editor', { mapData: scene.mapData, fromPlaytest: true });
    } else {
      window.location.reload();
    }
  }
  els.restartButton.addEventListener('click', returnFromGame);
  if (scene.fromEditor) {
    els.exitPlaytest.hidden = false;
    els.exitPlaytest.textContent = t('hud.exitPlaytest');
    els.exitPlaytest.addEventListener('click', returnFromGame);
  } else {
    els.exitPlaytest.hidden = true;
  }
  controller.onChange(() => {
    renderTopBarUI();
    showToast(controller.paused ? t('toast.paused') : t('toast.resumed'));
  });
  selection.onChange(renderSelection);
  orders.onOrder((type) => showToast(t(`toast.${type}`)));

  scene.input.on('pointermove', (pointer) => {
    const cx = Math.floor(pointer.worldX / 40).toString().padStart(2, '0');
    const cy = Math.floor(pointer.worldY / 40).toString().padStart(2, '0');
    els.coords.textContent = `GRID ${cx} : ${cy}`;
  });

  function update(delta) {
    status.accumulator += delta;
    if (status.accumulator < values.performance.hudRefreshMs) return;
    status.accumulator = 0;
    renderUnitList();
    renderCityCard();
    renderMission();
    renderEvents();
    renderTimer();
    renderVictory();
  }

  // 编队列表
  function renderUnitList() {
    const units = world.units.filter(unit => unit.state !== 'dead' && unit.faction === 'blue')
      .sort((a, b) => a.id - b.id);
    els.unitList.innerHTML = units.map(unit => `
      <div class="unit-card ${selection.isSelected(unit.id) ? 'active' : ''}" data-id="${unit.id}">
        <span class="unit-avatar blue-avatar">●</span>
        <span><b>${t('unit.fullname', { faction: t('faction.blue'), name: t(`unit.name.${unit.type}`), id: unit.id })}</b>
          <small>${t(`unit.status.${statusLabel(unit)}`)} · 血量 ${Math.round(unit.hp)} · 士气 ${Math.round(unit.morale)}</small></span>
        <span class="unit-hp"><i style="width:${unit.hp / unit.maxHp * 100}%"></i></span>
      </div>`).join('');
    els.unitCount.textContent = t('hud.units.count', { n: units.length.toString().padStart(2, '0') });
  }

  function statusLabel(unit) {
    if (unit.state === 'rout') return 'rout';
    if (unit.morale < values.morale.thresholds.shakenBelow) return 'shaken';
    if (unit.morale < values.morale.thresholds.weakenedBelow) return 'weakened';
    return 'normal';
  }

  // 城市状态（我方城市 c1 + 敌方信标 c2 的占领进度）
  function renderCityCard() {
    const blueCity = world.cities.find(city => city.faction === 'blue');
    if (!blueCity) { // 蓝军失去全部城市（失败结算后仍会渲染 HUD）
      els.cityCard.innerHTML = '';
      return;
    }
    const redCity = world.cities.find(city => city.faction === 'red');
    const supplied = world.units.filter(unit => unit.state !== 'dead' && unit.faction === 'blue' && unit.supplied).length;
    const productionLeft = Math.max(0, values.cities.production.interval - blueCity.productionTimer);
    els.cityCard.innerHTML = `
      <div class="status-row"><span>${t('hud.city.production')}</span><b>${productionLeft.toFixed(0)} s</b></div>
      <div class="status-row"><span>${t('hud.city.supply')}</span><b>${supplied} / ${values.supply.capacityPerCity}</b></div>
      ${redCity ? `
      <div class="status-row"><span>${t('hud.city.capture')} · ${t('city.label', { faction: t('faction.red') })}</span><b>${redCity.captureProgress.toFixed(0)}%</b></div>
      <div class="progress"><i style="width:${redCity.captureProgress}%"></i></div>` : ''}
      ${blueCity && blueCity.captureProgress > 0 ? `
      <div class="status-row"><span>${t('hud.city.capture')} · 己方基地</span><b>${blueCity.captureProgress.toFixed(0)}%</b></div>` : ''}`;
  }

  // 任务进度（gdd.md §10 任务链）：目标 2 = 完成一次移动指令；目标完成时提示并写入通讯。
  // 信标取自地图 objectives（编辑器试玩地图可能无任务，此时隐藏任务面板）。
  function renderMission() {
    const objective = world.map.objectives.find(item => item.type === 'captureCity');
    if (!objective) {
      els.missionPanel.style.display = 'none';
      return;
    }
    els.missionPanel.style.display = '';
    if (!status.obj2Done && world.units.some(unit =>
      unit.state !== 'dead' && unit.faction === 'blue' && unit.command !== null)) {
      status.obj2Done = true;
      objectiveCompleted('toast.obj2', 'event.obj2');
    }
    // 目标 3：信标周边 clearRadius 内无红军（gdd.md §10）
    const beacon = world.cities.find(city => city.id === objective.cityId);
    if (!status.obj3Done && beacon && !world.units.some(unit =>
      unit.state !== 'dead' && unit.faction === 'red'
      && Math.hypot(unit.x - beacon.x, unit.y - beacon.y) <= values.tutorial.clearRadius)) {
      status.obj3Done = true;
      objectiveCompleted('toast.obj3', 'event.obj3');
    }
    const redCity = world.cities.find(city => city.faction === 'red');
    if (!status.obj4Done && !redCity) {
      status.obj4Done = true;
      objectiveCompleted('toast.obj4', 'event.obj4');
    }
    const steps = [
      { done: true, key: 'hud.mission.obj1' },
      { done: status.obj2Done, key: 'hud.mission.obj2' },
      { done: status.obj3Done, key: 'hud.mission.obj3' },
      { done: status.obj4Done, key: 'hud.mission.obj4' },
    ];
    els.missionList.innerHTML = steps.map(step => `
      <div class="sub-objective ${step.done ? 'done' : ''}"><span>${step.done ? '✓' : '○'}</span>${t(step.key)}</div>`).join('');
    const percent = redCity ? Math.min(100, redCity.captureProgress) : 100;
    els.missionPercent.textContent = `${Math.round(percent)}%`;
    els.missionProgress.style.width = `${percent}%`;
  }

  function objectiveCompleted(toastKey, eventKey) {
    showToast(t(toastKey));
    els.eventLog.insertAdjacentHTML('afterbegin', `
      <p><time>${formatTime(world.time)}</time><span class="event-tag OK">OK</span>${t(eventKey)}</p>`);
    while (els.eventLog.children.length > 8) els.eventLog.lastElementChild.remove();
  }

  // 事件日志（world.history 增量）
  function renderEvents() {
    const entries = world.history.slice(status.lastEventIndex);
    status.lastEventIndex = world.history.length;
    if (entries.length === 0) return;
    const items = entries.map(event => formatEvent(event)).filter(Boolean);
    if (items.length === 0) return;
    els.eventLog.insertAdjacentHTML('afterbegin', items.reverse().map(item => `
      <p><time>${formatTime(item.time)}</time><span class="event-tag ${item.tag}">${item.tag}</span>${item.text}</p>`).join(''));
    while (els.eventLog.children.length > 8) els.eventLog.lastElementChild.remove();
  }

  function formatEvent(event) {
    if (event.type === 'cityCaptured') {
      return { tag: 'OK', time: event.at, text: t('event.cityCaptured', { faction: t(`faction.${event.faction}`), city: '信标' }) };
    }
    if (event.type === 'unitDied' && event.cause === 'surrender') {
      return { tag: 'WARN', time: event.at, text: t('event.surrender') };
    }
    return null;
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  // 计时与顶栏
  function renderTimer() {
    els.timer.textContent = formatTime(world.time);
  }

  function renderTopBarUI() {
    els.pauseButton.textContent = controller.paused ? '▶' : 'Ⅱ';
    for (const button of els.speedButtons) {
      button.classList.toggle('active', Number(button.dataset.speed) === controller.speed);
    }
  }

  function renderSelection() {
    const count = selection.selected.size;
    els.selectionReadout.textContent = count > 0
      ? t('hud.selection.count', { n: count })
      : t('hud.selection.none');
  }

  // 胜利结算（world.winner 置位后展示一次）
  function renderVictory() {
    if (!world.winner || status.victoryShown) return;
    status.victoryShown = true;
    const win = world.winner === 'blue';
    els.overlayTitle.textContent = t(win ? 'victory.title.win' : 'victory.title.lose');
    els.overlayTitle.classList.toggle('win', win);
    els.overlayTitle.classList.toggle('lose', !win);
    els.overlayDetail.textContent = t(win ? 'victory.detail.win' : 'victory.detail.lose')
      + ` · ${t('victory.time', { t: formatTime(world.endTime ?? world.time) })}`;
    els.overlay.classList.add('show');
    showToast(t('toast.victory'));
  }

  renderTopBarUI(); // 初始渲染（不弹 toast）

  return { update, showToast };
}
