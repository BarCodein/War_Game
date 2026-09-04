import { describe, expect, it } from 'vitest';
import {
  attackCommand, attackMoveCommand, holdCommand, moveCommand, validateCommand,
} from '../../src/simulation/commands.js';

describe('commands', () => {
  it('四类命令构造器产生合法命令', () => {
    expect(() => validateCommand(moveCommand([{ x: 0, y: 0 }, { x: 100, y: 100 }]))).not.toThrow();
    expect(() => validateCommand(attackMoveCommand({ x: 10, y: 20 }))).not.toThrow();
    expect(() => validateCommand(attackCommand(7))).not.toThrow();
    expect(() => validateCommand(holdCommand())).not.toThrow();
  });

  it('非法命令被拒绝', () => {
    expect(() => validateCommand({ type: 'nope' })).toThrow(/unknown command type/);
    expect(() => validateCommand(null)).toThrow(/must be an object/);
    expect(() => validateCommand(moveCommand([]))).toThrow(/non-empty path/);
    expect(() => validateCommand(moveCommand([{ x: 'a', y: 0 }]))).toThrow(/non-empty path/);
    expect(() => validateCommand(attackMoveCommand({ x: 1 }))).toThrow(/attackMove requires a \{ x, y \} target/);
    expect(() => validateCommand(attackCommand('7'))).toThrow(/numeric targetId/);
  });
});
