import { Router } from 'express';
import { requireUser } from './auth.js';
import { RoomError, normalizeCode, roomView } from '../rooms.js';

// 房间 REST（同源 + 会话 Cookie）：
//   POST /api/rooms                建房 → 201 {room}
//   GET  /api/rooms/:code          查房（房间不存在 404）
//   POST /api/rooms/:code/join     加入（409：已满 / 已开局 / 已加入）
//   POST /api/rooms/:code/ready    准备 / 取消准备（也可走 socket 的 match:ready）
//   POST /api/rooms/:code/leave    离开（房主离开 → 房间关闭）
export function createRoomRouter({ db, config, rooms }) {
  const router = Router();
  router.use(requireUser({ db, config }));

  const fail = (res, error) => {
    if (error instanceof RoomError) {
      return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
    }
    console.error('[rooms] 未预期错误:', error);
    return res.status(500).json({ ok: false, code: 'INTERNAL', message: '服务器内部错误' });
  };

  router.post('/', (req, res) => {
    try {
      const room = rooms.create({ user: req.user, levelId: req.body?.levelId });
      res.status(201).json({ ok: true, room: roomView(room, req.user.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/:code', (req, res) => {
    try {
      const room = rooms.require(normalizeCode(req.params.code));
      res.json({ ok: true, room: roomView(room, req.user.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/:code/join', (req, res) => {
    try {
      const role = req.body?.role ?? null;
      const room = rooms.join({ code: normalizeCode(req.params.code), user: req.user, role });
      res.json({ ok: true, room: roomView(room, req.user.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/:code/ready', (req, res) => {
    try {
      const code = normalizeCode(req.params.code);
      const room = rooms.setReady({ code, userId: req.user.id, ready: req.body?.ready !== false });
      res.json({ ok: true, room: roomView(room, req.user.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  // 结算窗「返回大厅」→ 大厅先调这个把已结束的房间重置成等待（房间码不变，可直接再开一局）
  router.post('/:code/rearm', (req, res) => {
    try {
      const code = normalizeCode(req.params.code);
      const player = rooms.playerOf(rooms.require(code), req.user.id);
      if (!player) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里', 409);
      const room = rooms.rearm({ code });
      res.json({ ok: true, room: roomView(room, req.user.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/:code/leave', (req, res) => {
    try {
      const result = rooms.leave({ code: normalizeCode(req.params.code), userId: req.user.id });
      // 关闭时不再回房间快照（房间已从注册表移除），只回 closed 标记
      res.json({ ok: true, closed: result.closed, room: result.closed ? null : roomView(result.room, req.user.id) });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
