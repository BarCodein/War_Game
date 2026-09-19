import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import values from '../../src/config/values.js';

// 城市生产当前**关闭**（values.cities.production.enabled = false，gdd.md §7）：
// 生产相关的用例在生产打开时才运行，关闭时改跑「不产出」的用例——
// 逻辑仍保留在 supply.js，改回 enabled: true 即自动恢复原有用例的覆盖。
const productionEnabled = values.cities.production.enabled;

function blueCityMap() {
  return makePlainMap({
    cities: [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
  });
}

describe('supply', () => {
  it('每城容量 5：有缺口的单位按代价升序分运力，分不到的进得慢（不再直接掉血）', () => {
    const world = makeWorld(blueCityMap());
    const units = [];
    // ⚠️ 只有**有缺口**的单位才申领运力：清空存量，让容量真正成为约束
    for (let i = 0; i < 6; i += 1) {
      const unit = world.spawnUnit('blue', 'light', 300 + i * 10, 600);
      unit.supplyStock = 0;
      units.push(unit);
    }
    advance(world, 1);
    // 单位会被软排斥推开，因此"谁获得补给"取决于到城市的路径代价，而不是 spawn 顺序。
    // 容量是**吞吐点数**：喂满一个单位要花 需求 ÷ 因子 点，因子 ≤ 1，
    // 所以一座 5 点的城一轮最多喂满 5 个；这里单位离城 200~280 px（因子 0.95→0.80），
    // 实测只有 4 个申领被满足，剩下的拿部分补给或一点都拿不到：
    const satisfied = units.filter(u => u.supplyRatio >= 1 - 1e-6);
    const short = units.filter(u => u.supplyRatio < 1 - 1e-6);
    expect(satisfied.length).toBeLessThanOrEqual(values.supply.capacityPerCity);
    expect(short.length).toBeGreaterThan(0);
    for (const unit of short) {
      // 进货速率 = 申领满足度 × 满额速率：补给不足就是进得慢，不再是"立刻掉血"
      // （掉血只看补给存量是否耗尽，见 supplyStock 系统）
      expect(unit.supplyIntake).toBeLessThan(
        values.supply.stockPerPoint * values.supply.demandPerUnit / values.supply.refreshSeconds,
      );
    }
    // 城市这一轮支出的吞吐点数不超过容量（超出的单位会被顺延到其他城市 / 直接断补）
    const load = [...world.citySupplyLoad.values()].reduce((sum, points) => sum + points, 0);
    expect(load).toBeLessThanOrEqual(values.supply.capacityPerCity + 1e-9);
  });

  it('因子随距离衰减：远城的单位要好几座城合力才喂得饱', () => {
    const world = makeWorld(blueCityMap());
    // 城在 (100,600)，单位在 300 px 外 → 因子 < 1，一座城要掏 1/因子 点
    const far = world.spawnUnit('blue', 'light', 400, 600);
    far.supplyStock = 0; // 有缺口才申领运力
    advance(world, 1);
    expect(far.supplyCost).toBeGreaterThan(100);       // 超过满额段
    expect(far.supplyEdges[0].factor).toBeLessThan(1); // 到手打了折
    expect(far.supplyEdges[0].points).toBeGreaterThan(1); // 城市掏的点数 > 需求
    expect(far.supplyRatio).toBe(1);                    // 近到一座城就够它这一轮的申领

    // 更远：路径代价接近因子下限，一座城（5 点）才能送到 1 点
    const world2 = makeWorld(blueCityMap());
    const veryFar = world2.spawnUnit('blue', 'light', 1200, 500);
    veryFar.supplyStock = 0;
    advance(world2, 1);
    expect(veryFar.supplyCost).toBeGreaterThan(900);     // 落在因子下限段
    expect(veryFar.supplyEdges[0].factor).toBe(0.2);     // 到手只有 20%
    expect(veryFar.supplyEdges[0].points).toBe(5);       // 一座城的全部运力
    expect(veryFar.supplyRatio).toBeCloseTo(1, 5);       // 刚好够（5 × 0.2 = 1）
  });

  it.runIf(!productionEnabled)('生产已关闭：城市不再自动产出单位，计时器保持为 0', () => {
    const world = makeWorld(blueCityMap());
    world.spawnUnit('blue', 'light', 150, 600);
    advance(world, 60); // 相当于旧规则下能产出 5 个的时间
    expect(world.units.filter(u => u.faction === 'blue')).toHaveLength(1);
    expect(world.cities.find(c => c.id === 'c1').productionTimer).toBe(0);

    // 补给未满、也没被围攻，同样不产出（生产整段被跳过）
    const empty = makeWorld(blueCityMap());
    advance(empty, 60);
    expect(empty.units).toHaveLength(0);
  });

  it.skipIf(!productionEnabled)('城市自动生产：12s 出一个轻型单位；补给满时暂停', () => {
    const world = makeWorld(blueCityMap());
    world.spawnUnit('blue', 'light', 150, 600);
    advance(world, 12.5);
    expect(world.units.filter(u => u.faction === 'blue').length).toBe(2);
    expect(world.units.find(u => u.faction === 'blue' && u.id !== 1).type).toBe('light');

    const full = makeWorld(blueCityMap());
    for (let i = 0; i < 5; i += 1) full.spawnUnit('blue', 'light', 300 + i * 10, 600);
    advance(full, 13);
    expect(full.units.filter(u => u.faction === 'blue').length).toBe(5); // 满补给，生产暂停
  });

  it.skipIf(!productionEnabled)('被敌方单位围攻时暂停生产', () => {
    const world = makeWorld(blueCityMap());
    world.spawnUnit('blue', 'light', 300, 600); // 守方不在地图半径内，避免交战
    world.spawnUnit('red', 'light', 150, 600);   // 距蓝城 50 ≤ 占领半径 60
    advance(world, 13);
    expect(world.units.filter(u => u.faction === 'blue').length).toBe(1); // 无产出
  });

  it('己方城市附近恢复生命 +3/s（上限封顶）', () => {
    const world = makeWorld(blueCityMap());
    const unit = world.spawnUnit('blue', 'light', 150, 600); // 距城 50 ≤ 120
    unit.hp = 50;
    advance(world, 1);
    expect(unit.hp).toBeCloseTo(53);
    advance(world, 5);
    expect(unit.hp).toBe(60); // 封顶
  });
});
