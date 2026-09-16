// 快捷键（gdd.md §11）：空格暂停/继续，Esc 取消选择，1/2/3 切换游戏速度，S 取消选中单位的所有指令。
import { holdCommand } from '../simulation/commands.js';

export function createKeyboard(scene, controller, selection) {
  scene.input.keyboard.on('keydown-SPACE', (event) => {
    event.preventDefault();
    controller.togglePause();
  });
  scene.input.keyboard.on('keydown-ESC', () => selection.clear());
  scene.input.keyboard.on('keydown-ONE', () => controller.setSpeed(0.5));
  scene.input.keyboard.on('keydown-TWO', () => controller.setSpeed(1));
  scene.input.keyboard.on('keydown-THREE', () => controller.setSpeed(2));
  scene.input.keyboard.on('keydown-S', () => {
    const ids = [...selection.selected];
    if (ids.length > 0) {
      scene.world.issueCommands(ids, holdCommand());
    }
  });
}
