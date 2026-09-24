/**
 * Getting into a game the server runs: ask the API for a room and a ticket, open the
 * socket, wait for the welcome. Entering the lobby's worlds, accepting an invitation
 * and reconnecting after a dropped link all end up here. The steps are injectable
 * (`PlayDeps`) so the flow is testable without a network.
 */
import { api, type PlayTicket } from './api'
import { ClientSession, type ClientStatus } from './ClientSession'
import type { Launch } from '../state/uiStore'
import type { WorldKind } from '../world/seed'

export interface PlayDeps {
  play(world: WorldKind): Promise<PlayTicket>
  join(code: string): Promise<PlayTicket>
  /** open the room's socket and wait for its welcome */
  connect(code: string, name: string, ticket: string): Promise<ClientSession>
}

/** the player's own world (they own it: they can invite and save) or the global world */
export async function playWorld(world: WorldKind, name: string, deps: PlayDeps): Promise<Launch> {
  const { room, ticket } = await deps.play(world)
  const session = await deps.connect(room.code, name, ticket)
  return { name, session, worldKind: world, owner: world === 'own' }
}

/** someone else's room by code (an accepted invitation) */
export async function joinRoom(code: string, name: string, worldKind: WorldKind, deps: PlayDeps): Promise<Launch> {
  const { room, ticket } = await deps.join(code)
  const session = await deps.connect(room.code, name, ticket)
  return { name, session, worldKind, owner: false }
}

/**
 * Back into the world the link dropped out of: our own and the global world are simply
 * entered again (the server reopens them if they closed meanwhile); a friend's room is
 * dialled by its code.
 */
export function rejoin(launch: Launch, deps: PlayDeps): Promise<Launch> {
  if (launch.owner || launch.worldKind === 'global') return playWorld(launch.worldKind, launch.name, deps)
  return joinRoom(launch.session.code, launch.name, launch.worldKind, deps)
}

/** the real thing: the API and a WebSocket; `onStatus` hears when the match ends */
export function liveDeps(onStatus: (session: ClientSession, status: ClientStatus) => void): PlayDeps {
  return {
    play: world => api.play(world),
    join: code => api.join(code),
    async connect(code, name, ticket) {
      const session = new ClientSession(code, name, ticket)
      session.onStatus = st => onStatus(session, st)
      try {
        await session.connect()
      } catch (e) {
        session.dispose()
        throw e
      }
      return session
    },
  }
}
