// 快捷键（gdd.md §11）：空格暂停/继续，Esc 取消选择，1/2/3 切换游戏速度，S 取消选中单位的所有指令。
//
// 单机与联机共用本模块（参数化）：
//   · 单机：`createKeyboard(scene, selection, { controller })` —— 四条键位与旧版完全一致；
//   · 联机：`createKeyboard(scene, selection, { issue, onHint })` —— 不传 controller 时
//     暂停/变速键只提示不生效（对局由服务器统一节奏），S 走注入的 `issue`（把命令发给服务器）。
import { holdCommand } from '../simulation/commands.js';

export function createKeyboard(scene, selection, options = {}) {
  const controller = options.controller ?? null;
  const issue = options.issue ?? ((unitIds, command) => scene.world.issueCommands(unitIds, command));
  const onHint = options.onHint ?? null;
  const keyboard = scene.input.keyboard;
  if (!keyboard) return null;

  if (controller) {
    keyboard.on('keydown-SPACE', (event) => {
      event.preventDefault();
      controller.togglePause();
    });
    keyboard.on('keydown-ONE', () => controller.setSpeed(0.5));
    keyboard.on('keydown-TWO', () => controller.setSpeed(1));
    keyboard.on('keydown-THREE', () => controller.setSpeed(2));
  } else {
    // 无 controller（联机）：这些键不生效，只给一句提示
    const hint = () => onHint?.('联机模式不支持暂停/变速（由服务器统一节奏）');
    for (const key of ['keydown-SPACE', 'keydown-ONE', 'keydown-TWO', 'keydown-THREE']) {
      keyboard.on(key, (event) => {
        event?.preventDefault?.();
        hint();
      });
    }
  }

  keyboard.on('keydown-ESC', () => selection.clear());
  keyboard.on('keydown-S', () => {
    const ids = [...selection.selected];
    if (ids.length > 0) {
      issue(ids, holdCommand());
    }
  });

  return { issue };
}
