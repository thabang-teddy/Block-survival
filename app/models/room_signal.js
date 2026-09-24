import { DateTime } from 'luxon';
import { RoomSignalSchema } from '#database/schema';
import Room from '#models/room';
import { sqlTime } from '#support/time';
export default class RoomSignal extends RoomSignalSchema {
    static table = 'room_signals';
    static PAGE = 50;
    static async pruneStale() {
        const cutoff = DateTime.now().minus({ hours: Room.TTL_HOURS });
        await RoomSignal.query().where('created_at', '<', sqlTime(cutoff)).delete();
    }
    toPublic() {
        return { id: this.id, from: this.fromPeer, type: this.type, data: JSON.parse(this.data) };
    }
}
//# sourceMappingURL=room_signal.js.map