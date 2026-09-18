// 统一命令接口：人类输入、脚本敌军（ai.js）与未来 AI 共用（REQUIREMENTS.md §4.5）。
// 命令经 world.issueCommands 下发并附带校验；格式见 architecture.md §5。
//
// `forced: true` = **急行军**（gdd.md §4）：除了水域之外的地形提速 1.5×，
// 代价是行军补给 -10/s 且每秒掉 1.5 血。move / attackMove / appendRoute / enqueueRoute 都支持。
export const commandTypes = ['move', 'attackMove', 'attack', 'hold', 'appendRoute', 'enqueueRoute', 'lock'];

export function moveCommand(path, { forced = false } = {}) {
  return { type: 'move', path, forced };
}

export function attackMoveCommand(target, { forced = false } = {}) {
  return { type: 'attackMove', target, forced };
}

export function attackCommand(targetId) {
  return { type: 'attack', targetId };
}

export function lockCommand(targetId) {
  return { type: 'lock', targetId };
}

export function holdCommand() {
  return { type: 'hold' };
}

export function appendRouteCommand(path, { forced = false } = {}) {
  return { type: 'appendRoute', path, forced };
}

export function enqueueRouteCommand(target, { forced = false } = {}) {
  return { type: 'enqueueRoute', target, forced };
}

export function validateCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('[commands] command must be an object');
  if (!commandTypes.includes(command.type)) throw new Error(`[commands] unknown command type: ${command.type}`);
  if (command.forced !== undefined && typeof command.forced !== 'boolean') {
    throw new Error('[commands] forced must be a boolean');
  }
  if (command.type === 'move') {
    if (!Array.isArray(command.path) || command.path.length === 0 || command.path.some(p => !isPoint(p))) {
      throw new Error('[commands] move requires a non-empty path of { x, y } points');
    }
  }
  if (command.type === 'attackMove' && !isPoint(command.target)) {
    throw new Error('[commands] attackMove requires a { x, y } target');
  }
  if ((command.type === 'attack' || command.type === 'lock') && !Number.isFinite(command.targetId)) {
    throw new Error('[commands] attack/lock requires a numeric targetId');
  }
  if (command.type === 'appendRoute') {
    if (!Array.isArray(command.path) || command.path.length === 0 || command.path.some(p => !isPoint(p))) {
      throw new Error('[commands] appendRoute requires a non-empty path of { x, y } points');
    }
  }
  if (command.type === 'enqueueRoute' && !isPoint(command.target)) {
    throw new Error('[commands] enqueueRoute requires a { x, y } target');
  }
  return command;
}

function isPoint(p) {
  return !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y);
}
