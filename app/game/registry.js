import { promisify } from 'node:util';
import { gzip as gzipCb } from 'node:zlib';
import { DateTime } from 'luxon';
import logger from '@adonisjs/core/services/logger';
import { HostSim } from '#game/sim/HostSim';
import { parseRules } from '#game/game/rules';
import { migrateSave } from '#game/net/saveMigrate';
import { makeRoomCode, MAX_PLAYERS } from '#game/net/limits';
import { GLOBAL_SEED, newWorldSeed } from '#game/world/seed';
import Device from '#models/device';
import Room from '#models/room';
import RoomSignal from '#models/room_signal';
import Score from '#models/score';
import User from '#models/user';
import World from '#models/world';
import AccessPolicy from '#services/access_policy';
import { inflateSave, storeWorld } from '#services/world_store';
import GameRules from '#support/game_rules';
import { sqlTime } from '#support/time';
import { GameRoom } from '#game-server/game_room';
import { TicketBook } from '#game-server/tickets';
const gzip = promisify(gzipCb);
const EMPTY_GRACE_MS = 60_000;
const SWEEP_MS = 10_000;
export class RoomRefusal extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export class RoomRegistry {
    rooms = new Map();
    opening = new Map();
    reserved = new Set();
    tickets = new TicketBook();
    sweeper = null;
    running(code) {
        const room = this.rooms.get(code.toUpperCase());
        return room && !room.isClosed ? room : undefined;
    }
    ownRoomOf(userId) {
        for (const room of this.rooms.values())
            if (room.kind === 'own' && room.ownerId === userId && !room.isClosed)
                return room;
        return undefined;
    }
    globalRoom() {
        for (const room of this.rooms.values())
            if (room.kind === 'global' && !room.isClosed)
                return room;
        return undefined;
    }
    presence() {
        const online = this.globalRoom()?.playerCount ?? 0;
        return { online, host_name: online > 0 ? 'the server' : null };
    }
    openOwn(user) {
        const running = this.ownRoomOf(user.id);
        if (running)
            return this.rowOf(running);
        return this.open(`own:${user.id}`, async () => {
            const save = await this.loadSave(await World.ownOf(user.id), user.id);
            return { kind: 'own', ownerId: user.id, hostName: user.name, save, seed: newWorldSeed() };
        });
    }
    async openGlobal() {
        const running = this.globalRoom();
        if (running) {
            if (running.playerCount >= MAX_PLAYERS)
                throw new RoomRefusal('The global world is full right now — try again in a moment.', 409);
            return this.rowOf(running);
        }
        return this.open('global', async () => {
            const save = await this.loadSave(await World.global(), 0);
            return { kind: 'global', ownerId: null, hostName: 'Global world', save, seed: GLOBAL_SEED };
        });
    }
    issueTicket(user, code, deviceId) {
        return this.tickets.issue({ userId: user.id, code: code.toUpperCase(), deviceId });
    }
    async admit(peer, ticketId) {
        const ticket = this.tickets.redeem(ticketId);
        if (!ticket)
            return { refusal: 'That link has expired — join again from the lobby.' };
        const user = await User.find(ticket.userId);
        if (!user)
            return { refusal: 'That account no longer exists.' };
        const room = this.running(ticket.code);
        if (!room)
            return { refusal: 'That game is over.' };
        room.connect(peer, { userId: user.id, name: user.name, deviceId: ticket.deviceId });
        return { room };
    }
    async close(code, reason, opts = {}) {
        const room = this.rooms.get(code.toUpperCase());
        if (!room)
            return;
        this.rooms.delete(room.code);
        await room.close(reason, opts).catch((err) => logger.error({ err, code: room.code }, 'closing a room failed'));
    }
    async closeOwn(userId, reason, opts = {}) {
        const room = this.ownRoomOf(userId);
        if (room)
            await this.close(room.code, reason, opts);
    }
    async resetGlobal() {
        const room = this.globalRoom();
        if (room && room.playerCount > 0)
            throw new RoomRefusal('Someone is in the global world — reset it when it is empty.', 409);
        if (room)
            await this.close(room.code, 'The global world was reset.', { save: false });
        await World.query().whereNull('user_id').where('kind', World.GLOBAL).delete();
    }
    startSweeping() {
        if (this.sweeper)
            return;
        this.sweeper = setInterval(() => {
            this.sweep().catch((err) => logger.error({ err }, 'sweeping rooms failed'));
        }, SWEEP_MS);
        this.sweeper.unref();
    }
    async sweep(now = Date.now()) {
        for (const room of [...this.rooms.values()]) {
            if (room.emptySince !== null && now - room.emptySince >= EMPTY_GRACE_MS) {
                await this.close(room.code, 'Everyone left.');
            }
        }
    }
    async shutdown() {
        if (this.sweeper)
            clearInterval(this.sweeper);
        this.sweeper = null;
        await Promise.all([...this.rooms.keys()].map((code) => this.close(code, 'The server is restarting — join again in a moment.')));
    }
    async open(key, load) {
        let pending = this.opening.get(key);
        if (!pending) {
            pending = load()
                .then((o) => this.create(o))
                .finally(() => this.opening.delete(key));
            this.opening.set(key, pending);
        }
        return this.rowOf(await pending);
    }
    async create(o) {
        const code = await this.freeCode();
        try {
            return await this.createWith(code, o);
        }
        finally {
            this.reserved.delete(code);
        }
    }
    async createWith(code, o) {
        const rules = parseRules((await GameRules.fromSettings()).toJSON());
        const sim = new HostSim({ seed: o.seed, rules, restore: o.save ?? undefined, ownerId: o.ownerId });
        await Room.create({
            code,
            hostPeerId: Room.SERVER_HOST,
            userId: o.ownerId,
            hostName: o.hostName.slice(0, 16),
            worldKind: o.kind,
            players: 1,
            expiresAt: Room.freshExpiry(),
        });
        const room = new GameRoom(code, o.kind, o.ownerId, sim, this.storeFor(code, o.kind, o.ownerId), Date.now, o.save === null);
        this.rooms.set(code, room);
        room.start();
        logger.info({ code, kind: o.kind, ownerId: o.ownerId }, 'room opened');
        return room;
    }
    async rowOf(room) {
        return Room.findByOrFail('code', room.code);
    }
    async freeCode() {
        for (;;) {
            const code = makeRoomCode();
            if (this.rooms.has(code) || this.reserved.has(code))
                continue;
            this.reserved.add(code);
            const row = await Room.findBy('code', code);
            if (!row)
                return code;
            if (row.expiresAt <= DateTime.now()) {
                await RoomSignal.query().where('room_code', code).delete();
                await row.delete();
                return code;
            }
            this.reserved.delete(code);
        }
    }
    async loadSave(world, ownerId) {
        if (!world)
            return null;
        const save = migrateSave(inflateSave(world.bytes()), ownerId);
        if (!save)
            logger.error({ world: world.id }, 'unreadable save; starting the world fresh');
        return save;
    }
    storeFor(code, kind, ownerId) {
        return {
            async saveWorld(save, night) {
                const bytes = await gzip(JSON.stringify(save));
                const result = await storeWorld(kind === 'global' ? null : ownerId, kind, bytes, night, save.time);
                if ('error' in result)
                    throw new Error(result.error);
            },
            async recordRun(run) {
                if (!(await User.find(run.userId)))
                    return;
                await Score.create({ ...run, score: Score.compute(run.nights, run.kills) });
            },
            async refreshRow(players) {
                await Room.query().where('code', code).update({ players, expires_at: sqlTime(Room.freshExpiry()) });
            },
            async removeRow() {
                await Room.query().where('code', code).delete();
            },
            async accessProblem(userId, deviceId) {
                const user = await User.find(userId);
                if (!user)
                    return 'That account no longer exists.';
                const reason = await AccessPolicy.blockedReason(user);
                if (reason)
                    return reason;
                const device = deviceId === null ? null : await Device.find(deviceId);
                return AccessPolicy.deviceAllowed(user, device) ? null : 'This PC is waiting for admin approval.';
            },
        };
    }
}
const rooms = new RoomRegistry();
export default rooms;
//# sourceMappingURL=registry.js.map