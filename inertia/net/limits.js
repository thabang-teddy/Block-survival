export const MAX_PLAYERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
export function makeRoomCode(random = Math.random) {
    let s = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++)
        s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    return s;
}
export const normalizeRoomCode = (input) => input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
export const isRoomCode = (code) => code.length === ROOM_CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c));
//# sourceMappingURL=limits.js.map