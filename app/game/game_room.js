import { validateClientMessage } from '#game/sim/validate';
import { decode, encode, MAX_PLAYERS, PROTOCOL_VERSION, SNAPSHOT_HZ } from '#game/net/protocol';
import { Autosave } from '#game/game/autosave';
import logger from '@adonisjs/core/services/logger';
export const TICK_HZ = 30;
const ROW_REFRESH_SECONDS = 15;
const ACCESS_CHECK_SECONDS = 30;
const MAX_MESSAGES_PER_SECOND = 240;
const HELLO_TIMEOUT_MS = 10_000;
const MAX_WAITING = 8;
export class GameRoom {
    code;
    kind;
    ownerId;
    store;
    now;
    sim;
    seats = new Map();
    autosave;
    timer = null;
    lastTick = 0;
    snapshotTimer = 0;
    rowTimer = 0;
    accessTimer = 0;
    rateTimer = 0;
    signature = '';
    closed = false;
    emptySince;
    constructor(code, kind, ownerId, sim, store, now = Date.now, fresh = false) {
        this.code = code;
        this.kind = kind;
        this.ownerId = ownerId;
        this.store = store;
        this.now = now;
        this.sim = sim;
        this.emptySince = now();
        this.autosave = new Autosave(() => this.store.saveWorld(this.sim.buildSave(), this.sim.dayNight.night));
        if (fresh)
            this.autosave.markDirty();
        sim.onRun = (run) => { this.store.recordRun(run).catch(() => { }); };
        sim.onDawn = () => { this.saveSoon(); };
    }
    get playerCount() {
        let n = 0;
        for (const s of this.seats.values())
            if (s.avatar)
                n++;
        return n;
    }
    get isClosed() {
        return this.closed;
    }
    start() {
        if (this.timer)
            return;
        this.lastTick = this.now();
        this.timer = setInterval(() => {
            const t = this.now();
            this.tick((t - this.lastTick) / 1000);
            this.lastTick = t;
        }, 1000 / TICK_HZ);
    }
    connect(peer, player) {
        if (this.closed) {
            this.send(peer, { t: 'bye' });
            peer.close();
            return;
        }
        for (const seat of this.seats.values()) {
            if (seat.userId !== player.userId)
                continue;
            this.sendState(seat.peer, 'You joined this game from somewhere else.');
            this.send(seat.peer, { t: 'bye' });
            seat.peer.close();
            this.disconnect(seat.peer);
        }
        if (this.seats.size - this.playerCount >= MAX_WAITING) {
            peer.close();
            return;
        }
        this.seats.set(peer.id, { ...player, name: player.name.slice(0, 16) || 'Survivor', peer, avatar: null, received: 0, since: this.now() });
    }
    receive(peer, bytes) {
        try {
            this.handle(peer, bytes);
        }
        catch (err) {
            logger.error({ err, code: this.code }, 'a game message failed');
        }
    }
    handle(peer, bytes) {
        const seat = this.seats.get(peer.id);
        if (!seat)
            return;
        if (++seat.received > MAX_MESSAGES_PER_SECOND) {
            peer.close();
            this.disconnect(peer);
            return;
        }
        let raw;
        try {
            raw = decode(bytes);
        }
        catch {
            return;
        }
        const msg = validateClientMessage(raw);
        if (!msg)
            return;
        if (!seat.avatar) {
            if (msg.t === 'hello')
                this.hello(seat, msg.v);
            return;
        }
        if (msg.t === 'save') {
            if (this.ownerId === null || seat.userId === this.ownerId) {
                this.autosave.saveNow().then(() => this.sendState(seat.peer, 'World saved'), () => this.sendState(seat.peer, 'Saving failed — the server will try again'));
            }
            return;
        }
        this.sim.apply(seat.avatar, msg);
    }
    disconnect(peer) {
        const seat = this.seats.get(peer.id);
        if (!seat)
            return;
        this.seats.delete(peer.id);
        if (!seat.avatar)
            return;
        this.sim.removePlayer(seat.avatar.id);
        this.sim.broadcastMessage(`${seat.avatar.name} left`);
        this.saveSoon();
        if (this.playerCount === 0)
            this.emptySince = this.now();
    }
    hello(seat, version) {
        if (version !== PROTOCOL_VERSION) {
            this.sendState(seat.peer, 'This page is out of date — reload it to play.');
            this.send(seat.peer, { t: 'bye' });
            seat.peer.close();
            this.seats.delete(seat.peer.id);
            return;
        }
        if (this.playerCount >= MAX_PLAYERS) {
            this.send(seat.peer, { t: 'full' });
            seat.peer.close();
            this.seats.delete(seat.peer.id);
            return;
        }
        const avatar = this.sim.addPlayer(seat.peer.id, seat.name, seat.userId);
        seat.avatar = avatar;
        this.emptySince = null;
        this.send(seat.peer, this.sim.welcome(avatar));
        this.send(seat.peer, this.sim.initialState(avatar));
        this.sim.broadcastMessage(`${avatar.name} joined`);
    }
    tick(dt) {
        if (this.closed)
            return;
        try {
            this.step(dt);
        }
        catch (err) {
            logger.error({ err, code: this.code }, 'a game tick failed');
        }
    }
    step(dt) {
        if (this.playerCount > 0)
            this.sim.tick(dt);
        const edits = this.sim.takeBlockEdits();
        if (edits.length)
            this.broadcast({ t: 'blocks', edits });
        this.snapshotTimer += dt;
        if (this.snapshotTimer >= 1 / SNAPSHOT_HZ) {
            this.snapshotTimer = Math.min(this.snapshotTimer - 1 / SNAPSHOT_HZ, 1 / SNAPSHOT_HZ);
            if (this.playerCount > 0)
                this.broadcast(this.sim.snapshot());
        }
        for (const seat of this.seats.values()) {
            if (!seat.avatar)
                continue;
            const state = this.sim.takeState(seat.avatar);
            if (state)
                this.send(seat.peer, state);
        }
        this.rateTimer += dt;
        if (this.rateTimer >= 1) {
            this.rateTimer = 0;
            for (const seat of this.seats.values())
                seat.received = 0;
        }
        this.tickSaving(dt);
        this.tickHousekeeping(dt);
    }
    tickSaving(dt) {
        const sig = this.sim.saveSignature();
        if (this.signature === '')
            this.signature = sig;
        else if (sig !== this.signature) {
            this.signature = sig;
            this.autosave.markDirty();
        }
        this.autosave.tick(dt);
    }
    tickHousekeeping(dt) {
        const now = this.now();
        for (const seat of [...this.seats.values()]) {
            if (seat.avatar || now - seat.since < HELLO_TIMEOUT_MS)
                continue;
            seat.peer.close();
            this.seats.delete(seat.peer.id);
        }
        this.rowTimer += dt;
        if (this.rowTimer >= ROW_REFRESH_SECONDS) {
            this.rowTimer = 0;
            this.store.refreshRow(Math.max(1, this.playerCount)).catch(() => { });
        }
        this.accessTimer += dt;
        if (this.accessTimer >= ACCESS_CHECK_SECONDS) {
            this.accessTimer = 0;
            void this.checkAccess();
        }
    }
    async checkAccess() {
        for (const seat of [...this.seats.values()]) {
            const problem = await this.store.accessProblem(seat.userId, seat.deviceId).catch(() => null);
            if (!problem || !this.seats.has(seat.peer.id))
                continue;
            this.sendState(seat.peer, problem);
            this.send(seat.peer, { t: 'bye' });
            seat.peer.close();
            this.disconnect(seat.peer);
        }
    }
    saveSoon() {
        this.autosave.markDirty();
        this.autosave.saveNow().catch(() => { });
    }
    saveNow() {
        return this.autosave.saveNow();
    }
    async close(reason, opts = {}) {
        if (this.closed)
            return;
        this.closed = true;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        for (const seat of [...this.seats.values()]) {
            try {
                this.sendState(seat.peer, reason);
                this.send(seat.peer, { t: 'bye' });
                seat.peer.close();
                if (seat.avatar)
                    this.sim.removePlayer(seat.avatar.id);
            }
            catch (err) {
                logger.error({ err, code: this.code }, 'sending a player off failed');
            }
        }
        this.seats.clear();
        if (opts.save !== false) {
            this.autosave.markDirty();
            await this.autosave.saveNow().catch(() => { });
        }
        await this.store.removeRow().catch(() => { });
    }
    send(peer, msg) {
        peer.send(encode(msg));
    }
    sendState(peer, message) {
        this.send(peer, { t: 'state', message });
    }
    broadcast(msg) {
        const bytes = encode(msg);
        for (const seat of this.seats.values())
            if (seat.avatar)
                seat.peer.send(bytes);
    }
}
//# sourceMappingURL=game_room.js.map