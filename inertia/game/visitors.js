import { restorePlayer, savedPlayerOf } from "./saveState.js";
export class Visitors {
    departed = new Map();
    constructor(initial = []) {
        for (const [id, p] of initial)
            this.departed.set(id, p);
    }
    get entries() {
        return this.departed;
    }
    arrive(a, userId) {
        if (userId === null)
            return false;
        const key = String(userId);
        const saved = this.departed.get(key);
        if (!saved)
            return false;
        restorePlayer(a, saved, false);
        this.departed.delete(key);
        return true;
    }
    take(userId) {
        const key = String(userId);
        const saved = this.departed.get(key) ?? null;
        this.departed.delete(key);
        return saved;
    }
    leaveSaved(userId, saved) {
        this.departed.set(userId, saved);
    }
    leave(a, userId) {
        if (userId === null)
            return;
        this.departed.set(String(userId), savedPlayerOf(a));
    }
}
//# sourceMappingURL=visitors.js.map