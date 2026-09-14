/**
 * Pure helpers behind the lobby's "Open games" list (the polling itself lives in
 * useOpenRooms). Kept free of React so they can be unit-tested.
 */
import type { OpenRoom } from '../net/api'

/** how often the lobby re-fetches the list while it is on screen */
export const OPEN_ROOMS_POLL_MS = 5000

export function isJoinable(room: OpenRoom, now: number = Date.now()): boolean {
  return room.players < room.max_players && Date.parse(room.expires_at) > now
}

/** "2/4" */
export function seatsText(room: OpenRoom): string {
  return `${room.players}/${room.max_players}`
}

/** newest first; a room with a free seat sorts above one that filled up mid-poll */
export function sortOpenRooms(rooms: readonly OpenRoom[], now: number = Date.now()): OpenRoom[] {
  return rooms.filter(r => isJoinable(r, now)).sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))
}
