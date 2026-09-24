import { getItem } from "./registry.js";
export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export class Inventory {
    slots = new Array(INVENTORY_SIZE).fill(null);
    version = 0;
    get(slot) {
        return this.slots[slot] ?? null;
    }
    hotbar() {
        return this.slots.slice(0, HOTBAR_SIZE);
    }
    all() {
        return this.slots.slice();
    }
    count(id) {
        let n = 0;
        for (const s of this.slots)
            if (s?.id === id)
                n += s.count;
        return n;
    }
    add(id, count) {
        const max = getItem(id).maxStack;
        let left = count;
        for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
            const s = this.slots[i];
            if (s && s.id === id && s.count < max) {
                const take = Math.min(max - s.count, left);
                this.slots[i] = { id, count: s.count + take };
                left -= take;
            }
        }
        for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
            if (this.slots[i])
                continue;
            const take = Math.min(max, left);
            this.slots[i] = { id, count: take };
            left -= take;
        }
        if (left !== count)
            this.version++;
        return left;
    }
    takeFromSlot(slot, count) {
        const s = this.slots[slot];
        if (!s)
            return 0;
        const n = Math.min(count, s.count);
        this.slots[slot] = s.count - n > 0 ? { id: s.id, count: s.count - n } : null;
        this.version++;
        return n;
    }
    remove(id, count) {
        if (this.count(id) < count)
            return false;
        let left = count;
        for (let i = INVENTORY_SIZE - 1; i >= 0 && left > 0; i--) {
            const s = this.slots[i];
            if (s?.id !== id)
                continue;
            const n = Math.min(s.count, left);
            this.slots[i] = s.count - n > 0 ? { id, count: s.count - n } : null;
            left -= n;
        }
        this.version++;
        return true;
    }
    replace(slots) {
        for (let i = 0; i < INVENTORY_SIZE; i++)
            this.slots[i] = slots[i] ? { ...slots[i] } : null;
        this.version++;
    }
    swap(a, b) {
        const tmp = this.slots[a];
        this.slots[a] = this.slots[b];
        this.slots[b] = tmp;
        this.version++;
    }
}
//# sourceMappingURL=inventory.js.map