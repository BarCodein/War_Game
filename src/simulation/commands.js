// 统一命令接口：人类输入、脚本敌军（ai.js）与未来 AI 共用（REQUIREMENTS.md §4.5）。
// 命令经 world.issueCommands 下发并附带校验；格式见 architecture.md §5。
export const commandTypes = ['move', 'attackMove', 'attack', 'hold'];

export function moveCommand(path) {
  return { type: 'move', path };
}

export function attackMoveCommand(target) {
  return { type: 'attackMove', target };
}

export function attackCommand(targetId) {
  return { type: 'attack', targetId };
}

export function holdCommand() {
  return { type: 'hold' };
}

export function validateCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('[commands] command must be an object');
  if (!commandTypes.includes(command.type)) throw new Error(`[commands] unknown command type: ${command.type}`);
  if (command.type === 'move') {
    if (!Array.isArray(command.path) || command.path.length === 0 || command.path.some(p => !isPoint(p))) {
      throw new Error('[commands] move requires a non-empty path of { x, y } points');
    }
  }
  if (command.type === 'attackMove' && !isPoint(command.target)) {
    throw new Error('[commands] attackMove requires a { x, y } target');
  }
  if (command.type === 'attack' && !Number.isFinite(command.targetId)) {
    throw new Error('[commands] attack requires a numeric targetId');
  }
  return command;
}

function isPoint(p) {
  return !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y);
}
