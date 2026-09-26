/**
 * Pure helpers behind the lobby's "Invitations" list (the polling itself lives in
 * useInvites). Kept free of React so they can be unit-tested. Issue #5: the only way
 * into someone else's world is an invitation from its host.
 */
import type { Invite } from '../net/api'
import type { WorldKind } from '../world/seed'

/** how often the lobby re-fetches the list while it is on screen */
export const INVITES_POLL_MS = 5000

/** pending, or accepted earlier (the invitee left and may go back in while the host is hosting) */
export function isJoinable(invite: Invite, now: number = Date.now()): boolean {
  return invite.status !== 'declined' && invite.players < invite.max_players && Date.parse(invite.expires_at) > now
}

/** "2/4" */
export function seatsText(invite: { players: number; max_players: number }): string {
  return `${invite.players}/${invite.max_players}`
}

/** newest first; an invite into a room that filled up mid-poll drops out */
export function sortInvites(invites: readonly Invite[], now: number = Date.now()): Invite[] {
  return invites.filter(i => isJoinable(i, now)).sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))
}

/** "Sam's world" / "the global world" */
export function worldLabel(kind: WorldKind, hostName: string): string {
  return kind === 'global' ? 'the global world' : `${hostName}'s world`
}
