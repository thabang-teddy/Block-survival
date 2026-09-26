/**
 * Lobby for the signed-in player. Two worlds to play — their own (a random seed; solo
 * or hosted for friends) and the shared global world (the classic seed, one save for
 * everyone, hosted by whoever is in it — entering either hosts it or joins the host),
 * plus the invitations other hosts have sent and the leaderboard. The user, the
 * leaderboard, the world summaries and who is in the global world are Inertia props
 * from PlayController; invitations are polled from /api/invites (issue #5).
 */
import { useEffect, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { followClientStatus, useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession, type ClientStatus } from '../net/ClientSession'
import { api, type Invite, type SaveData, type WorldMeta } from '../net/api'
import type { PlayProps } from '../net/pageProps'
import { formatTime, timeAgo } from '../game/score'
import { GLOBAL_SEED, newWorldSeed, seedTag } from '../world/seed'
import { useInvites } from './useInvites'
import { seatsText, worldLabel } from './invites'
import { enterGlobal, liveDeps } from '../net/globalWorld'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type Busy = '' | 'host' | 'solo' | 'reset' | 'global' | `join:${number}`

export function MainMenu() {
  const { auth, leaderboard, worlds, presence } = usePage<PlayProps>().props
  const user = auth.user
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [busy, setBusy] = useState<Busy>('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const invites = useInvites(!busy)

  // the leaderboard, the worlds and who is in the global world change while a run is
  // in progress (autosaves, scores); pull fresh copies whenever the menu comes back
  useEffect(() => {
    router.reload({ only: ['leaderboard', 'worlds', 'presence'] })
  }, [])

  const playerName = user.name

  /** the player's own saved world, if there is one; the host's game continues from it */
  const restore = async (): Promise<SaveData | undefined> =>
    worlds.own ? (await api.loadWorld('own')) ?? undefined : undefined

  /** a client hears about the end of the match through the net-status overlay */
  const onClientStatus = (session: ClientSession, st: ClientStatus) => followClientStatus(session, st)
  const watch = (session: ClientSession) => { session.onStatus = st => onClientStatus(session, st) }

  const solo = async () => {
    setBusy('solo')
    setError('')
    try {
      start({ role: 'host', name: playerName, session: new HostSession(), restore: await restore(), worldKind: 'own', seed: newWorldSeed() })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  const host = async () => {
    setBusy('host')
    setError('')
    const session = new HostSession()
    try {
      const saved = await restore()
      await session.listen(playerName, 'own')
      start({ role: 'host', name: playerName, session, restore: saved, worldKind: 'own', seed: newWorldSeed() })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  /** the global world: host it if nobody is, otherwise join whoever is */
  const enter = async () => {
    setBusy('global')
    setStatus('Entering…')
    setError('')
    try {
      start(await enterGlobal(playerName, liveDeps({
        onStatus: setStatus,
        onClientStatus,
        onHostLost: reason => setNetStatus('error', reason),
      })))
    } catch (e) {
      setError(errorText(e))
      setBusy('')
      setStatus('')
      router.reload({ only: ['presence'] })
    }
  }

  const accept = async (invite: Invite) => {
    setBusy(`join:${invite.id}`)
    setError('')
    const session = new ClientSession(invite.code, playerName)
    watch(session)
    try {
      // accepting is what unlocks the room's peer id and mailbox for us
      await api.acceptInvite(invite.id)
      await session.connect()
      start({ role: 'client', name: playerName, session, worldKind: invite.world_kind })
    } catch (e) {
      session.dispose()
      setError(errorText(e))
      setBusy('')
      invites.refresh()
    }
  }

  const decline = async (invite: Invite) => {
    try {
      await api.declineInvite(invite.id)
    } catch (e) {
      setError(errorText(e))
    }
    invites.refresh()
  }

  const startOver = async () => {
    if (!confirm('Delete your world and start again? This cannot be undone.')) return
    setBusy('reset')
    setError('')
    try {
      await api.resetWorld()
      router.reload({ only: ['worlds'] })
    } catch (e) {
      setError(errorText(e))
    }
    setBusy('')
  }

  const summary = (w: WorldMeta | null, fresh: string): string =>
    w
      ? `Night ${w.night} · ${formatTime(w.seconds)} survived · ${w.players} player${w.players === 1 ? '' : 's'} have played · saved ${timeAgo(w.updated_at)}.`
      : fresh

  // host_name with nobody in is the host PC, which holds the world whether or not anyone plays
  const whoIsIn = presence.paused
    ? `Paused — waiting for ${presence.host_name ?? 'the host PC'} to come back${presence.online > 0 ? ` (${presence.online} waiting)` : ''}.`
    : presence.online > 0
      ? `${presence.online} online now, hosted by ${presence.host_name ?? 'someone'} — you would join them.`
      : presence.host_name
        ? `Nobody is in it right now — ${presence.host_name} hosts it.`
        : 'Nobody is in it right now — you would host it.'

  return (
    <div className="menu">
      <div className="menu-card">
        <h1>Block Survival</h1>
        <p className="tagline">Build by day. Hold the line by night.</p>

        <p className="account-line">
          Signed in as <b>{user.name}</b> ·{' '}
          {user.is_admin && <><a className="link" href="/admin">admin</a> ·{' '}</>}
          <button className="link" onClick={() => router.post('/logout')}>sign out</button>
        </p>

        <div className="lobby">
          <section className="option">
            <h3>My world</h3>
            <p>Your own map, with its own seed — nobody visits without an invitation.</p>
            <p className="fine">{summary(worlds.own, 'A fresh world with a new seed — it saves itself every minute, at dawn, and when you leave.')}</p>
            <button className="wide primary" onClick={() => void solo()} disabled={!!busy}>
              {busy === 'solo' ? 'Loading…' : 'Play solo'}
            </button>
            <button className="wide" onClick={() => void host()} disabled={!!busy}>
              {busy === 'host' ? 'Opening room…' : 'Host for friends'}
            </button>
            {worlds.own && (
              <p className="fine">
                <button className="link" onClick={() => void startOver()} disabled={!!busy}>
                  {busy === 'reset' ? 'Resetting…' : 'Start over with a new world'}
                </button>
              </p>
            )}
          </section>
          <section className="option">
            <h3>Global world</h3>
            <p>The classic map ({seedTag(GLOBAL_SEED)}) everyone builds in together. Whoever is in it hosts it; when they leave, the next player in takes over.</p>
            <p className="fine">{summary(worlds.global, 'Nobody has played the global world yet.')} {whoIsIn}</p>
            <button className="wide primary" onClick={() => void enter()} disabled={!!busy}>
              {busy === 'global' ? status : 'Enter'}
            </button>
          </section>

          <section className="option">
            <h3>Invitations</h3>
            <p>Friends who are hosting right now and asked you in.</p>
            <ul className="open-games" aria-label="Invitations">
              {invites.invites.map(i => (
                <li key={i.id}>
                  <span className="host">{i.host_name}<small> · {worldLabel(i.world_kind, i.host_name)}</small></span>
                  <span className="seats">{seatsText(i)}</span>
                  <button onClick={() => void accept(i)} disabled={!!busy}>
                    {busy === `join:${i.id}` ? 'Joining…' : 'Accept'}
                  </button>
                  <button className="link" onClick={() => void decline(i)} disabled={!!busy}>decline</button>
                </li>
              ))}
              {invites.loaded && invites.invites.length === 0 && (
                <li className="empty">{invites.error ? `Could not load invitations: ${invites.error}` : 'No invitations right now'}</li>
              )}
            </ul>
          </section>
        </div>
        {error && <p className="error">{error}</p>}

        {leaderboard.length > 0 && (
          <div className="board">
            <h3>Leaderboard</h3>
            <ol>
              {leaderboard.map((r, i) => (
                <li key={i}><span>{r.name}</span><b>{r.score}</b></li>
              ))}
            </ol>
          </div>
        )}
        <p className="fine">Up to 4 players. The host&apos;s browser runs the world — in your own world the match ends when you leave; in the global world the next player takes over. Invite friends from the pause screen once you are hosting your own world.</p>
      </div>
    </div>
  )
}
