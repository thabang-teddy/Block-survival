/**
 * The host's memory of players who are not connected right now (issue #13): what they
 * had when they left, or what the save said they had. A returning account gets it back;
 * the whole book goes into the next save.
 */
import type { SavedPlayer } from '../net/api'
import { restorePlayer, savedPlayerOf, type SavableAvatar } from './saveState'

export class Visitors {
  private readonly departed = new Map<string, SavedPlayer>()

  constructor(initial: Iterable<[string, SavedPlayer]> = []) {
    for (const [id, p] of initial) this.departed.set(id, p)
  }

  /** everyone we are holding gear for, by account id */
  get entries(): ReadonlyMap<string, SavedPlayer> {
    return this.departed
  }

  /** a player connected: hand back what we kept for their account, if anything */
  arrive(a: SavableAvatar, userId: number | null): boolean {
    if (userId === null) return false
    const key = String(userId)
    const saved = this.departed.get(key)
    if (!saved) return false
    restorePlayer(a, saved, false)
    this.departed.delete(key)
    return true
  }

  /** an entry straight from a save (the player is not here yet) */
  leaveSaved(userId: string, saved: SavedPlayer): void {
    this.departed.set(userId, saved)
  }

  /** a player disconnected: remember them until they come back or the world is saved */
  leave(a: SavableAvatar, userId: number | null): void {
    if (userId === null) return
    this.departed.set(String(userId), savedPlayerOf(a))
  }
}
