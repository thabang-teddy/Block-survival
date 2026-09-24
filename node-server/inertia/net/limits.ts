/**
 * Room size and room codes: shared by the game client, the host sim and the server,
 * so this module imports nothing.
 */
export const MAX_PLAYERS = 4

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O to avoid confusion
export const ROOM_CODE_LENGTH = 6

export function makeRoomCode(random: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return s
}

export const normalizeRoomCode = (input: string): string => input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH)
export const isRoomCode = (code: string): boolean => code.length === ROOM_CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c))
