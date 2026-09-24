import { DateTime } from 'luxon'
import { RoomSignalSchema } from '#database/schema'
import Room from '#models/room'
import { sqlTime } from '#support/time'

export type SignalType = 'offer' | 'answer' | 'candidate'

/**
 * One WebRTC signalling message (offer / answer / ICE candidate) waiting for the peer it
 * is addressed to — for native clients hosting peer-to-peer. Peers poll their mailbox
 * with an id cursor. `data` holds the opaque SDP or candidate as JSON.
 */
export default class RoomSignal extends RoomSignalSchema {
  static table = 'room_signals'
  /** the most rows one poll returns; a full handshake is ~20 */
  static readonly PAGE = 50

  /** Signals older than a room's lifetime can never be collected — drop them. */
  static async pruneStale(): Promise<void> {
    const cutoff = DateTime.now().minus({ hours: Room.TTL_HOURS })
    await RoomSignal.query().where('created_at', '<', sqlTime(cutoff)).delete()
  }

  toPublic(): { id: number; from: string; type: SignalType; data: Record<string, unknown> } {
    return { id: this.id, from: this.fromPeer, type: this.type as SignalType, data: JSON.parse(this.data) }
  }
}
