/**
 * Getting into a global world (docs/pc-host-research.md §8). Each is run by a host PC:
 * the server says where its room is (`client`), that the PC went quiet and everyone
 * waits for it (`paused`), or that the world closed (`offline`). Browsers never host a
 * global world. The loop is pure over `GlobalWorldDeps` so it is testable without a
 * network; `liveDeps` wires the real modules.
 */
import { api, ApiError, type GlobalState } from './api'
import { ClientSession, type HostKind } from './ClientSession'
import type { WorldKind } from '../world/seed'
import type { Launch } from '../state/uiStore'

/** how often a player waiting on the paused host PC asks whether it is back (it may take hours) */
export const PAUSE_POLL_MS = 5000
export const PAUSED_TEXT = 'Host PC offline, game paused, reconnecting…'

/** the world closed while we were in it or on the way in */
export class WorldOfflineError extends Error {}

export interface GlobalWorldDeps {
  join(world: number): Promise<GlobalState>
  claim(): Promise<GlobalState>
  /** connect to the room and wait for its welcome */
  connect(code: string, name: string, hostKind?: HostKind): Promise<ClientSession>
  sleep(ms: number): Promise<void>
  /** progress the lobby / overlay can show while waiting */
  onStatus?(text: string): void
}

/** from the lobby: take a seat in that world and go in */
export async function enterGlobal(world: number, name: string, deps: GlobalWorldDeps): Promise<Launch> {
  return settle(await deps.join(world), name, deps)
}

/**
 * The link dropped but the world is most likely still there: ask the server where we
 * stand and go back in. A seat that was swept while the tab was away is taken again.
 */
export async function reconnectGlobal(world: number, name: string, deps: GlobalWorldDeps): Promise<Launch> {
  let state: GlobalState
  try {
    state = await deps.claim()
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e
    state = await deps.join(world)
  }
  return settle(state, name, deps)
}

/**
 * The host PC went quiet while we were in its world (docs/pc-host-research.md §5.4):
 * the game is frozen behind the pause screen. Every PAUSE_POLL_MS we ask the server
 * (which also keeps our seat): while the PC is paused we wait — however long it takes;
 * once it is back we join it again, into the spot we left. `stillPaused` false means the
 * old link came back by itself (the PC only froze), and null is returned: carry on as is.
 */
export async function awaitHostPc(world: number, name: string, deps: GlobalWorldDeps, stillPaused: () => boolean): Promise<Launch | null> {
  deps.onStatus?.(PAUSED_TEXT)
  for (;;) {
    await deps.sleep(PAUSE_POLL_MS)
    if (!stillPaused()) return null
    let state: GlobalState
    try {
      state = await deps.claim()
    } catch (e) {
      // our seat went: the world was closed (or our tab slept through the sweep)
      if (e instanceof ApiError && e.status === 404) state = await joinOrOffline(world, deps)
      // the site itself may be unreachable from here for a while: keep waiting
      else if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) continue
      else throw e
    }
    if (state.status === 'paused') continue
    if (!stillPaused()) return null
    if (state.status === 'offline') throw new WorldOfflineError(state.message)
    // for up to 45 s after the PC dies the site still counts it as online: an unanswered join is more waiting
    try {
      return await clientLaunch(state.room.code, name, world, deps, 'global', 'pc')
    } catch {
      deps.onStatus?.(PAUSED_TEXT)
    }
  }
}

/** a friend's room after a dropped link: the same code, dialled again */
export function rejoinRoom(code: string, name: string, worldKind: WorldKind, deps: GlobalWorldDeps): Promise<Launch> {
  return clientLaunch(code, name, null, deps, worldKind)
}

/** a 409 from join is the world being offline; it says so in its message */
async function joinOrOffline(world: number, deps: GlobalWorldDeps): Promise<GlobalState> {
  try {
    return await deps.join(world)
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new WorldOfflineError(e.message)
    throw e
  }
}

async function settle(first: GlobalState, name: string, deps: GlobalWorldDeps): Promise<Launch> {
  let state = first
  for (;;) {
    if (state.status === 'offline') throw new WorldOfflineError(state.message)
    if (state.status === 'client') return clientLaunch(state.room.code, name, state.world, deps, 'global', 'pc')
    // the PC runs the world and will be back: no deadline while we wait for it
    deps.onStatus?.(PAUSED_TEXT)
    await deps.sleep(PAUSE_POLL_MS)
    state = await deps.claim()
  }
}

async function clientLaunch(code: string, name: string, world: number | null, deps: GlobalWorldDeps, worldKind: WorldKind = 'global', hostKind: HostKind = 'browser'): Promise<Launch> {
  deps.onStatus?.(hostKind === 'pc' ? 'Joining the host PC…' : 'Joining…')
  const session = await deps.connect(code, name, hostKind)
  return world === null
    ? { role: 'client', name, session, worldKind }
    : { role: 'client', name, session, worldKind, globalWorld: world }
}

export interface LiveDepsOptions {
  onStatus?(text: string): void
  /** wired onto every ClientSession so the HUD hears when the match ends */
  onClientStatus?(session: ClientSession, status: ClientSession['status']): void
}

/** the real thing: the API, WebRTC sessions and the wall clock */
export function liveDeps(opts: LiveDepsOptions = {}): GlobalWorldDeps {
  return {
    join: world => api.joinGlobal(world),
    claim: () => api.claimGlobal(),
    async connect(code, name, hostKind = 'browser') {
      const session = new ClientSession(code, name, hostKind)
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
    onStatus: opts.onStatus,
  }
}
