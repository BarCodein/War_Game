// 快捷键（gdd.md §11）：空格暂停/继续，Esc 取消选择，1/2/3 切换游戏速度。
export function createKeyboard(scene, controller, selection) {
  scene.input.keyboard.on('keydown-SPACE', (event) => {
    event.preventDefault();
    controller.togglePause();
  });
  scene.input.keyboard.on('keydown-ESC', () => selection.clear());
  scene.input.keyboard.on('keydown-ONE', () => controller.setSpeed(0.5));
  scene.input.keyboard.on('keydown-TWO', () => controller.setSpeed(1));
  scene.input.keyboard.on('keydown-THREE', () => controller.setSpeed(2));
}
