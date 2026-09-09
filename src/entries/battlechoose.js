import { t } from '../i18n/index.js';
import { campaigns, loadProgress, startCampaign } from '../entries/battlechoose-data.js';

// ──────────────────────────────────────────────
// 过场动画接口（cutscene）
//
// 返回一个 Promise，resolve 时过场动画播放完毕。
// TODO: 在此处填入具体的过场动画逻辑（CSS 动画 / Canvas 渲染 / 音频等）。
// 当前实现：静态展示 1.4s 后淡出，使用 CSS transition 完成。
// ──────────────────────────────────────────────
export async function playCutscene() {
  const overlay = document.getElementById('cutsceneOverlay');
  if (!overlay) return; // 无遮罩元素时跳过

  // 确保遮罩初始可见（opacity:1），然后等待展示时间
  overlay.style.opacity = '1';
  overlay.classList.remove('fade-out');

  // TODO: 在此处填入具体的过场动画逻辑。
  // 示例：
  //   await animateFadeIn(overlay, 800);
  //   await animateSlideText(overlay, 1200);
  //   await animateFadeOut(overlay, 600);

  // 当前实现：静态展示 1.4s 后淡出
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 1400);
    // 页面切换或卸载时清除定时器
    window.addEventListener('unload', () => clearTimeout(timer));
  });

  overlay.classList.add('fade-out');
  // 等待 CSS transition 完成（600ms）
  await new Promise(resolve => setTimeout(resolve, 600));
  overlay.style.display = 'none';
}

// ──────────────────────────────────────────────
// 渲染关卡卡片
// ──────────────────────────────────────────────
function renderBattleCards() {
  const grid = document.getElementById('battleCardGrid');
  if (!grid) return;

  const progress = loadProgress();

  grid.innerHTML = campaigns.map((campaign, index) => {
    const prog = progress[campaign.id] ?? {};
    const isCompleted = prog.completed === true;
    const statusClass = isCompleted ? 'completed' : 'available';
    const statusText = isCompleted
      ? t('battlechoose.card.status.completed')
      : t('battlechoose.card.status.available');

    return `
      <div class="battle-card">
        <div class="battle-card-header">
          <span class="battle-card-number">0${index + 1}</span>
          <span class="battle-card-status ${statusClass}">${statusText}</span>
        </div>
        <div>
          <h2>${campaign.name}</h2>
          <span class="eyebrow-sub">${campaign.subtitle}</span>
        </div>
        <p>${campaign.description}</p>
        <div class="battle-card-footer">
          <span style="font: 9px 'IBM Plex Mono', monospace; color: var(--muted); letter-spacing: 1px;">
            ${t('battlechoose.card.difficulty')}: ${campaign.difficulty}
          </span>
          <button class="battle-card-btn" data-campaign-id="${campaign.id}">
            <span>▶</span>
            <span>${t('battlechoose.card.start')}</span>
          </button>
        </div>
      </div>`;
  }).join('');

  // 绑定开始战斗按钮
  grid.querySelectorAll('.battle-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const campaignId = btn.dataset.campaignId;
      startCampaign(campaignId);
    });
  });
}

// ──────────────────────────────────────────────
// 页面初始化
// ──────────────────────────────────────────────
async function init() {
  // 1. 填充 i18n 文案
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.title = t('battlechoose.page.title');

  // 2. 播放过场动画，完成后显示关卡卡片
  await playCutscene();

  renderBattleCards();

  const grid = document.getElementById('battleCardGrid');
  if (grid) grid.classList.add('visible');
}

init();
