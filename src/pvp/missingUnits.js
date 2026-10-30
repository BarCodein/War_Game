import { isSpotted } from '../simulation/systems/fog.js';

// 快照里**没有出现**的单位该怎么判定（PvP 客户端，纯函数便于单测）。
//
// 规则（2026-10-30 修 bug）：
//   · 己方单位缺席 → 阵亡；
//   · 敌方单位缺席：
//       - 迷雾由**客户端**算（fogAuthority='client'，服务器下发全部存活单位）→ 缺席即阵亡；
//       - 服务端按视野过滤（fogAuthority='server'）→ 缺席可能只是"脱离视野"，
//         只有当它**此刻仍被我方目视**时才判定阵亡。
//
// ⚠️ 部署版（origin/main 517430e）的旧实现只处理了己方单位，敌方一律"当它只是脱离视野"，
// 于是"在我视野内被打死的敌军"会从快照里消失、却在客户端镜像里一直保持 alive ——
// 只要我方视野覆盖那个位置，渲染层就会继续把它画成一个活着的单位（带旧血量）。
// 详见 docs/pvp-plan.md §11.13。
//
// 调用约定：`seen` = 本帧快照里出现过的单位 id 集合；调用前必须先 `updateFog(world)`
// （`isSpotted` 读的是 `world.fog` 网格）。
export function markVanishedUnits(world, seen, myFaction, fogAuthority = 'client') {
  let vanished = 0;
  for (const unit of world.units) {
    if (unit.state === 'dead' || seen.has(unit.id)) continue;
    if (unit.faction === myFaction) {
      unit.state = 'dead';
      vanished += 1;
      continue;
    }
    if (fogAuthority !== 'server' || isSpotted(world, unit, myFaction)) {
      unit.state = 'dead';
      vanished += 1;
    }
  }
  return vanished;
}
