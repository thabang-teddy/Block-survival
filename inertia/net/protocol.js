import { pack, unpack } from 'msgpackr';
export const PROTOCOL_VERSION = 2;
export const INPUT_HZ = 30;
export const SNAPSHOT_HZ = 20;
export const INTERPOLATION_DELAY = 0.1;
export { MAX_PLAYERS } from "./limits.js";
export const encode = (msg) => new Uint8Array(pack(msg));
export const decode = (data) => unpack(data instanceof Uint8Array ? data : new Uint8Array(data));
export { makeRoomCode, normalizeRoomCode, isRoomCode, ROOM_CODE_LENGTH } from "./limits.js";
//# sourceMappingURL=protocol.js.map