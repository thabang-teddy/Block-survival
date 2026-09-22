/**
 * Getting into the shared global world. The server keeps a queue of the players
 * inside it; the front of the queue hosts and the rest connect to that room. Entering
 * from the lobby (`enterGlobal`) and taking over after the host went away (`handover`)
 * are the same loop: ask the server what to do, wait while the chosen host opens their
 * room, then either open ours or connect. The loop is pure over `GlobalWorldDeps` so it
 * is testable without a network; `liveDeps` wires the real modules.
 */
import { api, ApiError, type GlobalState, type SaveData, type SavedPlayer } from './api'
import { HostSession } from './HostSession'
import { ClientSession } from './ClientSession'
import { GLOBAL_SEED, type WorldKind } from '../world/seed'
import type { Launch } from '../state/uiStore'

/** how often a player still waiting for a host asks the server again */
export const CLAIM_POLL_MS = 3000
/** how long to wait for someone to open a room before giving up */
export const HANDOVER_TIMEOUT_MS = 90_000

export interface GlobalWorldDeps {
  userId: number
  join(): Promise<GlobalState>
  claim(): Promise<GlobalState>
  loadWorld(): Promise<SaveData | null>
  /** open our room for the global world and return the session listening on it */
  openRoom(name: string): Promise<HostSession>
  /** connect to the host's room and wait for its welcome */
  connect(code: string, name: string): Promise<ClientSession>
  sleep(ms: number): Promise<void>
  now(): number
  /** progress the lobby / overlay can show while waiting */
  onStatus?(text: string): void
}

/** from the lobby: a new seat at the back of the queue */
export async function enterGlobal(name: string, deps: GlobalWorldDeps): Promise<Launch> {
  return settle(await deps.join(), name, null, null, deps)
}

/**
 * The host went away while we were connected: keep our place and follow the queue.
 * `mine` is our own gear and standing as the client last saw it — if we end up hosting,
 * it overrides whatever the old host's last (possibly stale) upload held for us.
 */
export async function handover(name: string, mine: SavedPlayer | null, oldCode: string, deps: GlobalWorldDeps): Promise<Launch> {
  return settle(await deps.claim(), name, mine, oldCode, deps)
}

/**
 * The link dropped but the world is most likely still there: ask the server where we
 * stand and go back in — to the same room if it is still the one, to the new host's if
 * the queue moved on, or hosting ourselves (with our own gear carried over) if we are
 * now at the front. A seat that was swept while the tab was away is taken again from
 * the back of the queue.
 */
export async function reconnectGlobal(name: string, mine: SavedPlayer | null, deps: GlobalWorldDeps): Promise<Launch> {
  let state: GlobalState
  try {
    state = await deps.claim()
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e
    state = await deps.join()
  }
  return settle(state, name, mine, null, deps)
}

/** a friend's room after a dropped link: the same code, dialled again */
export function rejoinRoom(code: string, name: string, worldKind: WorldKind, deps: GlobalWorldDeps): Promise<Launch> {
  return clientLaunch(code, name, deps, worldKind)
}

async function settle(first: GlobalState, name: string, mine: SavedPlayer | null, oldCode: string | null, deps: GlobalWorldDeps): Promise<Launch> {
  const deadline = deps.now() + HANDOVER_TIMEOUT_MS
  let state = first
  for (;;) {
    if (state.status === 'host') return hostLaunch(name, mine, deps)
    if (state.status === 'client' && state.room.code !== oldCode) return clientLaunch(state.room.code, name, deps)
    if (deps.now() >= deadline) throw new Error('Nobody opened the global world in time — try again from the lobby.')
    deps.onStatus?.(state.status === 'pending' ? `Waiting for ${state.host_name} to open the world…` : 'Waiting for the next host…')
    await deps.sleep(CLAIM_POLL_MS)
    state = await deps.claim()
  }
}

async function hostLaunch(name: string, mine: SavedPlayer | null, deps: GlobalWorldDeps): Promise<Launch> {
  deps.onStatus?.('Loading the world…')
  const saved = await deps.loadWorld()
  const restore = saved && mine ? { ...saved, players: { ...saved.players, [String(deps.userId)]: mine } } : saved ?? undefined
  const session = await deps.openRoom(name)
  return { role: 'host', name, session, restore, worldKind: 'global', seed: GLOBAL_SEED }
}

async function clientLaunch(code: string, name: string, deps: GlobalWorldDeps, worldKind: WorldKind = 'global'): Promise<Launch> {
  deps.onStatus?.('Joining…')
  const session = await deps.connect(code, name)
  return { role: 'client', name, session, worldKind }
}

export interface LiveDepsOptions {
  onStatus?(text: string): void
  /** wired onto every ClientSession and HostSession so the HUD hears when the match ends */
  onClientStatus?(session: ClientSession, status: ClientSession['status']): void
  onHostLost?(reason: string): void
}

/** the real thing: the API, WebRTC sessions and the wall clock */
export function liveDeps(opts: LiveDepsOptions = {}): GlobalWorldDeps {
  return {
    userId: api.user?.id ?? 0,
    join: () => api.joinGlobal(),
    claim: () => api.claimGlobal(),
    loadWorld: () => api.loadWorld('global'),
    async openRoom(name) {
      const session = new HostSession()
      session.onLost = reason => opts.onHostLost?.(reason)
      await session.listen(name, 'global')
      return session
    },
    async connect(code, name) {
      const session = new ClientSession(code, name)
      session.onStatus = st => opts.onClientStatus?.(session, st)
      try {
        await session.connect()
      } catch (e) {
        session.dispose()
        throw e
      }
      return session
    },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    onStatus: opts.onStatus,
  }
}
