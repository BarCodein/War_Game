import { t } from '../i18n/index.js';
import { values } from '../config/index.js';
import { saveProgress } from '../entries/battlechoose-data.js';
import { levelHref, rememberLevelId } from '../level-link.js';

// 结算页 URL 参数（纯函数，便于单测）：
//   result=victory|defeat · level=<关卡 id> · t=<用时> · casualtiesBlue/casualtiesRed=<双方伤亡>
// 伤亡 = 己方/敌方**损失的血量**（1 点血 = 1 点伤亡），由 World.damageUnit 累计。
export function resultQuery({ win, campaignId, timeText, casualties }) {
  const params = new URLSearchParams();
  params.set('result', win ? 'victory' : 'defeat');
  if (campaignId) params.set('level', campaignId);
  params.set('t', timeText);
  params.set('casualtiesBlue', String(Math.round(casualties?.blue ?? 0)));
  params.set('casualtiesRed', String(Math.round(casualties?.red ?? 0)));
  return params.toString();
}

// HUD（DOM 实现，gdd.md §11 布局）：编队列表、城市状态、任务进度、事件日志、
// 顶栏控制与胜利结算。文案全部走 i18n；按 performance.hudRefreshMs 节流刷新。
export function createHud(scene, world, controller, selection, orders) {
  const els = {
    pauseButton: document.querySelector('#pauseButton'),
    speedButtons: document.querySelectorAll('[data-speed]'),
    zoomLabel: document.querySelector('#zoomLabel'),
    zoomReset: document.querySelector('#zoomReset'),
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
    missionEyebrow: document.querySelector('#missionEyebrow'),
    missionLevelName: document.querySelector('#missionLevelName'),
    tacticalEyebrow: document.querySelector('#tacticalEyebrow'),
    // 复古全屏 HUD（game.html 里手写的三个浮层元素）：
    //   vg-task-list  左侧任务面板条目容器（由 renderMission 驱动真实任务数据）
    //   vgClockText   左上角计时器（由 renderTimer 驱动 world.time，非自跑）
    //   vgTaskPanel   任务面板整体（无任务时隐藏）
    vgTaskPanel: document.querySelector('.vg-task-panel'),
    vgTaskList: document.querySelector('.vg-task-list'),
    vgClockText: document.querySelector('#vgClockText'),
  };

  // 动态设置关卡名称（从 level JSON 读取，替代 HTML 硬编码）
  const levelName = scene.level?.name ?? '';
  if (levelName) {
    if (els.missionLevelName) els.missionLevelName.textContent = levelName;
    if (els.tacticalEyebrow) els.tacticalEyebrow.textContent = `TACTICAL VIEW / ${levelName}`;
  }

  const status = {
    obj2Done: false,
    obj3Done: false,
    obj4Done: false,
    victoryShown: false,
    lastEventIndex: 0,
    accumulator: 0,
    timeWarnings: new Set(), // 已触发的时间预警阈值（避免重复）
  };

  // 顶部弹出的 toast 通知已移除（如「任务完成」）——相关进度只保留在右侧战场通讯日志。
  function showToast() {
    return;
  }

  // 顶栏
  els.pauseButton.addEventListener('click', () => controller.togglePause());
  // 编队列表（事件委托，innerHTML 重建后无需重绑）
  if (els.unitList) {
    els.unitList.addEventListener('click', (e) => {
      if (e.target.closest('.unit-card')) window.playSfx?.('tap');
    });
  }
  for (const button of els.speedButtons) {
    button.addEventListener('click', () => controller.setSpeed(Number(button.dataset.speed)));
  }
  // 缩放复位（滚轮缩放本身由 src/rendering/cameraView.js 处理）
  els.zoomReset?.addEventListener('click', () => scene.mapCamera?.reset());
  // 返回目标：编辑器试玩结束后安全返回编辑器（REQUIREMENTS.md §4.6），否则重开教学关
  function returnFromGame() {
    if (scene.fromEditor) {
      // 编辑器为独立页面，试玩后返回编辑器页（带 fromPlaytest 以恢复编辑中的地图）
      window.location.href = '/editor.html?fromPlaytest=1';
    } else {
      window.location.reload();
    }
  }
  // 胜利后进入下一关：关卡顺序取自关卡索引（与战役选择页同源），只携带关卡 id
  function continueAfterVictory() {
    const levels = scene.levelIndex ?? [];
    const currentIndex = levels.findIndex(level => level.id === scene.campaignId);
    const nextLevel = currentIndex >= 0 ? levels[currentIndex + 1] : null;
    if (nextLevel) {
      rememberLevelId(nextLevel.id);
      window.location.href = levelHref('/game.html', nextLevel.id);
      return;
    }
    window.location.href = '/battlechoose.html';
  }
  els.restartButton.addEventListener('click', () => {
    if (world.winner === 'blue' && !scene.fromEditor) {
      continueAfterVictory();
      return;
    }
    returnFromGame();
  });
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
    renderTopBarUI(); // 暂停/速度按钮与缩放读数（滚轮缩放是连续的，必须随节流刷新）
    renderUnitList();
    renderCityCard();
    renderMission();
    renderEvents();
    renderTimer();
    renderVictory();
    checkVictoryConditionsTransition();
    checkTimeWarnings();
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
    // 生产已关闭时不显示倒计时（否则会显示一个永远不会归零的假倒计时）
    const productionRow = values.cities.production.enabled
      ? `<div class="status-row"><span>${t('hud.city.production')}</span><b>${Math.max(0, values.cities.production.interval - blueCity.productionTimer).toFixed(0)} s</b></div>`
      : '';
    els.cityCard.innerHTML = `
      ${productionRow}
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
    // 复古全屏 HUD：左侧任务面板（vg-task-list）由真实任务数据驱动，覆盖旧的内嵌 missionPanel。
    renderVgTasks();

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
      && Math.hypot(unit.x - beacon.x, unit.y - beacon.y) <= 200)) {
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

  // ---------- 复古全屏任务面板（vg-task-list）----------
  // 从 world.mess（buildMission 产出的任务规则）与 world 实时状态生成任务条目。
  // 无任务规则（沙盒/编辑器试玩/纯失城判负）时隐藏整块面板。
  // 每条任务 = { done, text }，其中 text 用 i18n 键查表，实时 done 用状态回填。
  const vgTaskStates = { lastSignature: null, hidden: new Set() };
  function renderVgTasks() {
    const panel = els.vgTaskPanel;
    const list = els.vgTaskList;
    if (!panel || !list) return;
    const mess = world.mess;

    // 无任务规则 → 隐藏任务面板（旧 missionPanel 已有类似逻辑）
    if (!mess) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';

    const tasks = buildVgTasks(mess);
    // 用签名比对避免每帧重写 innerHTML（会打断用户点击三角的交互状态）。
    // 签名必须包含 done 与文案全文：文案里有实时数字（剩余时间/据点数/歼灭数），
    // 数字变化也要触发重写，否则计时会"卡住"。
    const signature = tasks.map(task => `${task.done ? 1 : 0}:${task.text}`).join('|');
    if (signature === vgTaskStates.lastSignature) return;
    vgTaskStates.lastSignature = signature;

    list.innerHTML = tasks.map((task, i) => `
      <li class="vg-task-item ${task.done ? 'vg-task-done' : ''}">
        <span class="vg-task-tri"></span>
        <span class="vg-task-card" ${vgTaskStates.hidden.has(i) ? 'style="display:none"' : ''}>${task.text}</span>
      </li>`).join('');

    // 重新绑定三角点击（innerHTML 重建后旧监听丢失）——隐藏/显示该条任务
    list.querySelectorAll('.vg-task-tri').forEach((tri, i) => {
      tri.style.cursor = 'pointer';
      tri.addEventListener('click', (e) => {
        e.stopPropagation();
        window.playSfx?.('tap');
        const card = tri.closest('.vg-task-item')?.querySelector('.vg-task-card');
        if (!card) return;
        const hidden = card.style.display === 'none';
        card.style.display = hidden ? '' : 'none';
        if (hidden) vgTaskStates.hidden.delete(i);
        else vgTaskStates.hidden.add(i);
      });
    });
  }

  // 按任务规则 mode 生成真实任务文案（defend 坚守 / attack 夺取 / annihilative 消灭）。
  // 文案走 i18n（vg.* 键），实时 done 按当前据点归属 / 时限 / 歼灭目标回填。
  function buildVgTasks(mess) {
    const fac = mess.faction;          // 玩家视角阵营（defend=防守方，attack/annihilative=我方）
    const enemy = fac === 'blue' ? 'red' : 'blue';
    const timeLimit = Number.isFinite(mess.time) ? Math.max(0, Math.round(mess.time)) : null;
    const points = mess.points ?? [];
    const tasks = [];

    if (mess.mode === 'defend') {
      const held = points.filter(p => p.faction === fac).length;
      const total = points.length;
      const timeLeft = timeLimit != null ? Math.max(0, timeLimit - Math.floor(world.time)) : null;
      tasks.push({
        done: total > 0 && held === total,
        text: t('vg.mission.defendHold', { held, total }),
      });
      if (timeLeft != null) {
        tasks.push({
          done: world.winner === fac,
          text: t('vg.mission.defendSurvive', { time: formatTime(timeLeft) }),
        });
      }
    } else if (mess.mode === 'attack') {
      const captured = points.filter(p => p.faction === fac).length;
      const total = points.length;
      tasks.push({
        done: total > 0 && captured === total,
        text: t('vg.mission.attackCapture', { captured, total }),
      });
      if (timeLimit != null) {
        tasks.push({
          done: world.winner === fac,
          text: t('vg.mission.attackBefore', { time: formatTime(Math.max(0, timeLimit - Math.floor(world.time))) }),
        });
      }
    } else if (mess.mode === 'annihilative') {
      const targets = world.units.filter(unit => unit.faction === enemy && unit.objective === 'annihilate');
      const alive = targets.filter(unit => unit.state !== 'dead').length;
      tasks.push({
        done: targets.length > 0 && alive === 0,
        text: t('vg.mission.annihilate', { alive, total: targets.length }),
      });
    }

    // 始终补一条通用目标（消灭敌军 / 守住基地），让面板不至于只有孤零零一条
    const baseCity = world.cities.find(city => city.faction === fac);
    tasks.push({
      done: world.winner === fac,
      text: baseCity
        ? t('vg.mission.holdBase', { city: baseCity.id })
        : t('vg.mission.eliminateEnemy'),
    });

    return tasks;
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
    // 战斗音效：据点易主 → 爆炸音（不分敌我，自己夺回来也播）
    for (const event of entries) {
      if (event.type === 'capturePointCaptured') {
        window.playSfx?.('explosion');
        break; // 单帧多事件只播一次
      }
    }
  }

  function formatEvent(event) {
    if (event.type === 'cityCaptured') {
      return { tag: 'OK', time: event.at, text: t('event.cityCaptured', { faction: t(`faction.${event.faction}`), city: '信标' }) };
    }
    if (event.type === 'capturePointCaptured') {
      return { tag: 'OK', time: event.at, text: t('event.pointCaptured', { faction: t(`faction.${event.faction}`), point: event.pointId }) };
    }
    if (event.type === 'unitDied' && event.cause === 'surrender') {
      return { tag: 'WARN', time: event.at, text: t('event.surrender') };
    }
    return null;
  }

  // ---------- 战斗音效 ----------
  // 规则：
  //   1. 任一存活单位 state==='combat' → 每隔 BLADE_INTERVAL ms 播一次 blade（白刃战循环音）
  //   2. 上一帧有战斗、这一帧战斗结束 → 立即停（自然衰减）
  //   3. world.history 新增的 unitDied/cause==='combat' 事件 → 播一次 hurt（击杀音）
  // 实现：
  //   - 独立的 setInterval（80ms 检查一次），不依赖 hud 的节流刷新（hud 100ms+ 一次，
  //     跟音频循环节奏不齐，会出现节奏抖动）
  //   - 死亡事件直接从 world.history 增量读取（与 renderEvents 同一份增量，
  //     不重复触发）
  const BLADE_INTERVAL = 1500; // 毫秒；combat 状态下 blade 的循环间隔（用户要求更长间隔）
  const COMBAT_CHECK_INTERVAL = 80; // 检查战斗状态的频率
  const combatSfx = {
    bladeTimer: null,
    inCombatLastCheck: false,
    lastBladeAt: 0,
  };

  function isInCombat() {
    for (const u of world.units) {
      if (u.state === 'combat') return true;
    }
    return false;
  }

  function checkCombatSfx() {
    const inCombat = isInCombat();
    if (!inCombat) {
      // 战斗结束（或从未开打）：blade 自然停止，无需额外操作
      combatSfx.inCombatLastCheck = false;
      return;
    }
    const now = performance.now();
    if (now - combatSfx.lastBladeAt >= BLADE_INTERVAL) {
      window.playSfx?.('blade');
      combatSfx.lastBladeAt = now;
    }
    combatSfx.inCombatLastCheck = true;
  }

  function checkDeathSfx() {
    // 增量读 world.history（用独立的 lastDeathIndex，与 renderEvents 互不影响）
    if (!combatSfx.lastDeathIndex) combatSfx.lastDeathIndex = 0;
    const newEvents = world.history.slice(combatSfx.lastDeathIndex);
    combatSfx.lastDeathIndex = world.history.length;
    // 单帧多单位同时阵亡只播一次 hurt（避免叠加噪音）
    let anyCombatDeath = false;
    for (const event of newEvents) {
      if (event.type === 'unitDied' && event.cause === 'combat') {
        anyCombatDeath = true;
      }
    }
    if (anyCombatDeath) window.playSfx?.('hurt');
  }

  // 启动两个独立定时器（用变量保存 ID，createHud 返回时由调用方清理）
  const combatSfxIntervals = [
    setInterval(checkCombatSfx, COMBAT_CHECK_INTERVAL),
    setInterval(checkDeathSfx, values.performance.hudRefreshMs),
  ];
  function clearCombatSfx() {
    combatSfxIntervals.forEach(clearInterval);
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  // 计时与顶栏
  function renderTimer() {
    const text = formatTime(world.time);
    els.timer.textContent = text;
    // 左上角复古计时器（vgClockText）同步 world.time，受暂停/加速控制，与战场节奏一致
    if (els.vgClockText) els.vgClockText.textContent = text;
  }

  function renderTopBarUI() {
    els.pauseButton.textContent = controller.paused ? '▶' : 'Ⅱ';
    for (const button of els.speedButtons) {
      button.classList.toggle('active', Number(button.dataset.speed) === controller.speed);
    }
    // 缩放读数：1× 时把复位按钮置灰（地图页才有 mapCamera，编辑器试玩路径同样有）
    if (els.zoomLabel && scene.mapCamera) {
      els.zoomLabel.textContent = `${Math.round(scene.mapCamera.zoomPercent)}%`;
      if (els.zoomReset) els.zoomReset.disabled = !scene.mapCamera.isZoomed;
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

    // 正式对局：直接跳转独立结算页 result.html（不弹内嵌结算窗口）。
    // result.html 按胜负提供 重新开始/下一战场 + 返回主界面 按钮。
    if (!scene.fromEditor) {
      if (win && scene.campaignId) {
        saveProgress(scene.campaignId, { completed: true, wins: 1 });
      }
      const params = resultQuery({
        win,
        campaignId: scene.campaignId,
        timeText: formatTime(world.endTime ?? world.time),
        casualties: world.casualties,
      });
      /* 胜利/失败先放一段仪式感视频（result-video.html），再跳到 result.html */
      window.location.href = `/result-video.html?${params}`;
      return;
    }

    // 编辑器试玩：保留内嵌结算（返回目标永远是编辑器，不走战役结算流程）。
    if (win && scene.campaignId) {
      saveProgress(scene.campaignId, { completed: true, wins: 1 });
      const levels = scene.levelIndex ?? [];
      const currentIndex = levels.findIndex(level => level.id === scene.campaignId);
      els.restartButton.textContent = levels[currentIndex + 1]
        ? t('victory.next')
        : t('victory.select');
    } else {
      els.restartButton.textContent = t('victory.restart');
    }
    els.overlayTitle.textContent = t(win ? 'victory.title.win' : 'victory.title.lose');
    els.overlayTitle.classList.toggle('win', win);
    els.overlayTitle.classList.toggle('lose', !win);
    els.overlayDetail.textContent = t(win ? 'victory.detail.win' : 'victory.detail.lose')
      + ` · ${t('victory.time', { t: formatTime(world.endTime ?? world.time) })}`;
    els.overlay.classList.add('show');
    showToast(t('toast.victory'));
  }

  // 胜利条件弹窗：准备阶段居中放大，战斗开始后缩小至右上角
  let victoryConditionsPrepping = true;
  function renderVictoryConditions() {
    if (!els.victoryConditions) return;
    const victory = scene.level?.victory;
    const mode = victory?.mode ?? victory?.type ?? 'captureAll';
    const time = victory?.time;
    let key = 'victory.conditions.default';
    if (mode === 'annihilative') key = time ? 'victory.conditions.annihilative' : 'victory.conditions.annihilative.notime';
    else if (mode === 'defend') key = time ? 'victory.conditions.defend' : 'victory.conditions.defend.notime';
    else if (mode === 'attack') key = time ? 'victory.conditions.attack' : 'victory.conditions.attack.notime';
    else if (mode === 'captureAll') key = 'victory.conditions.captureAll';
    const text = time ? t(key, { time: String(time) }) : t(key);
    els.victoryConditions.innerHTML = `
      <div class="overlay-heading"><span>${t('victory.conditions.title')}</span></div>
      <div class="victory-conditions-text">${text}</div>`;
    // 初始状态：准备阶段（编辑器试玩跳过准备，直接进入战斗状态）
    if (controller.isPrepping()) {
      els.victoryConditions.classList.add('prep');
    } else {
      victoryConditionsPrepping = false;
      els.victoryConditions.classList.add('battle');
    }
  }

  // 战斗开始时：准备阶段 → 战斗阶段的过渡
  function checkVictoryConditionsTransition() {
    if (!els.victoryConditions || !victoryConditionsPrepping) return;
    if (controller.isPrepping()) return;
    victoryConditionsPrepping = false;
    els.victoryConditions.classList.remove('prep');
    els.victoryConditions.classList.add('battle');
  }

  // 时间预警：限时关卡剩余60s/30s/10s时在事件日志中提示
  const TIME_WARNING_THRESHOLDS = [60, 30, 10];
  function checkTimeWarnings() {
    const mess = world.mess;
    if (!mess || !Number.isFinite(mess.time)) return;
    const remaining = mess.time - world.time;
    for (const threshold of TIME_WARNING_THRESHOLDS) {
      if (remaining <= threshold && remaining > 0 && !status.timeWarnings.has(threshold)) {
        status.timeWarnings.add(threshold);
        const key = threshold <= 10 ? 'event.timeWarning.critical' : 'event.timeWarning';
        els.eventLog.insertAdjacentHTML('afterbegin',
          `<p><time>${formatTime(world.time)}</time><span class="event-tag WARN">WARN</span>${t(key, { time: String(threshold) })}</p>`);
        while (els.eventLog.children.length > 8) els.eventLog.lastElementChild.remove();
      }
    }
  }

  renderTopBarUI(); // 初始渲染（不弹 toast）
  renderVictoryConditions();

  // 暴露 destroy 方法：GameScene 在 SHUTDOWN 时调用，清理战斗音效的 setInterval
  function destroy() {
    clearCombatSfx();
  }

  return { update, showToast, destroy };
}
