import { randomBytes } from 'node:crypto'

/** how long a ticket may wait for its socket */
export const TICKET_SECONDS = 30

export interface Ticket {
  userId: number
  code: string
  /** the device the ticket was asked for from, re-checked while the player is connected */
  deviceId: number | null
}

/**
 * One-time tickets that carry an HTTP sign-in over to the game's WebSocket: the API
 * (which ran the session / token and access checks) issues one for a room, and the
 * socket that presents it within TICKET_SECONDS is that player in that room.
 */
export class TicketBook {
  private readonly tickets = new Map<string, Ticket & { expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  issue(ticket: Ticket): string {
    this.sweep()
    const id = randomBytes(24).toString('base64url')
    this.tickets.set(id, { ...ticket, expiresAt: this.now() + TICKET_SECONDS * 1000 })
    return id
  }

  /** the ticket, once: redeeming it spends it */
  redeem(id: string | null | undefined): Ticket | null {
    if (!id) return null
    const t = this.tickets.get(id)
    this.tickets.delete(id)
    if (!t || t.expiresAt < this.now()) return null
    return { userId: t.userId, code: t.code, deviceId: t.deviceId }
  }

  private sweep(): void {
    const now = this.now()
    for (const [id, t] of this.tickets) if (t.expiresAt < now) this.tickets.delete(id)
  }
}
