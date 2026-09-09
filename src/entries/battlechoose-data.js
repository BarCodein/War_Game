// 战役数据配置
// 每个战役对应一张地图 JSON，可扩展更多关卡。
// structure:
//   id          — 唯一标识（用于 localStorage 存档 key）
//   name        — 战役中文名
//   subtitle    — 战役英文名（显示副标题）
//   description — 战役简介
//   mapPath     — public/assets/maps/<file>.json 相对路径
//   difficulty  — '教学' | '简单' | '中等' | '困难'

export const campaigns = [
  {
    id: 'fracture-canyon',
    name: '断裂峡谷',
    subtitle: 'FRACTURE CANYON',
    description: '教学战役。学习基础指挥：选择单位、移动路径、攻击前进。占领北方信标，赢得第一场战斗。',
    mapPath: '/assets/maps/fracture-canyon.json',
    difficulty: '教学',
  },
  // TODO: 后续关卡在此追加，例如：
  // {
  //   id: 'river-crossing',
  //   name: '渡江之战',
  //   subtitle: 'RIVER CROSSING',
  //   description: '利用桥梁跨越水域，切断敌军补给线……',
  //   mapPath: '/assets/maps/river-crossing.json',
  //   difficulty: '简单',
  // },
];

/**
 * 读取本地存档，返回 { [campaignId]: { completed?: boolean, wins?: number } }
 * 当前仅记录通关状态，后续可扩展完成次数、用时等。
 */
export function loadProgress() {
  try {
    const raw = localStorage.getItem('war-of-dots.campaign-progress');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 保存进度到 localStorage。
 * @param {string} campaignId
 * @param {object} data  写入字段，例如 { completed: true, wins: 1 }
 */
export function saveProgress(campaignId, data) {
  const all = loadProgress();
  all[campaignId] = { ...(all[campaignId] ?? {}), ...data };
  localStorage.setItem('war-of-dots.campaign-progress', JSON.stringify(all));
}

/**
 * 开始一场战役：跳转到 game.html 并传入地图路径作为 URL 参数。
 * BootScene 会读取此参数并加载对应地图。
 *
 * @param {string} campaignId
 */
export function startCampaign(campaignId) {
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return;
  // 将地图路径作为查询参数传递，BootScene 通过此参数加载对应地图
  window.location.href = `/game.html?campaign=${encodeURIComponent(campaign.id)}&map=${encodeURIComponent(campaign.mapPath)}`;
}
