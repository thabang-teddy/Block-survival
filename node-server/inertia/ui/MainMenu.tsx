/**
 * Lobby for the signed-in player. Two worlds to play, both run by the server — their
 * own (a random seed; friends come in by invitation) and the shared global world (the
 * classic seed, one save for everyone) — plus the invitations other players have sent
 * and the leaderboard. The user, the leaderboard, the world summaries and who is in the
 * global world are Inertia props from PlayController; invitations are polled from
 * /api/invites (issue #5).
 */
import { useEffect, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { useUiStore } from '../state/uiStore'
import type { ClientSession, ClientStatus } from '../net/ClientSession'
import { api, type Invite, type WorldMeta } from '../net/api'
import type { PlayProps } from '../net/pageProps'
import { formatTime, timeAgo } from '../game/score'
import { GLOBAL_SEED, seedTag, type WorldKind } from '../world/seed'
import { useInvites } from './useInvites'
import { seatsText, worldLabel } from './invites'
import { joinRoom, liveDeps, playWorld } from '../net/play'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type Busy = '' | 'own' | 'reset' | 'global' | `join:${number}`

export function MainMenu() {
  const { auth, leaderboard, worlds, presence } = usePage<PlayProps>().props
  const user = auth.user
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [busy, setBusy] = useState<Busy>('')
  const [error, setError] = useState('')
  const invites = useInvites(!busy)

  // the leaderboard, the worlds and who is in the global world change while a run is
  // in progress (autosaves, scores); pull fresh copies whenever the menu comes back
  useEffect(() => {
    router.reload({ only: ['leaderboard', 'worlds', 'presence'] })
  }, [])

  const playerName = user.name

  /** the match ends for this player through the net-status overlay */
  const onClientStatus = (session: ClientSession, st: ClientStatus) => {
    if (st === 'closed') setNetStatus('closed', session.error)
    else if (st === 'error') setNetStatus('error', session.error)
  }
  const deps = liveDeps(onClientStatus)

  /** our own world or the global one: the server opens it if nobody is in it */
  const play = async (world: WorldKind) => {
    setBusy(world)
    setError('')
    try {
      start(await playWorld(world, playerName, deps))
    } catch (e) {
      setError(errorText(e))
      setBusy('')
      router.reload({ only: ['presence'] })
    }
  }

  const accept = async (invite: Invite) => {
    setBusy(`join:${invite.id}`)
    setError('')
    try {
      // accepting is what lets us into the room
      await api.acceptInvite(invite.id)
      start(await joinRoom(invite.code, playerName, invite.world_kind, deps))
    } catch (e) {
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

  const whoIsIn = presence.online > 0
    ? `${presence.online} online now — you would join them.`
    : 'Nobody is in it right now.'

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
            <p>Your own map, with its own seed — nobody visits without an invitation. Invite friends from the pause screen.</p>
            <p className="fine">{summary(worlds.own, 'A fresh world with a new seed — it saves itself every minute, at dawn, and when you leave.')}</p>
            <button className="wide primary" onClick={() => void play('own')} disabled={!!busy}>
              {busy === 'own' ? 'Loading…' : 'Play'}
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
            <p>The classic map ({seedTag(GLOBAL_SEED)}) everyone builds in together, kept running by the server however players come and go.</p>
            <p className="fine">{summary(worlds.global, 'Nobody has played the global world yet.')} {whoIsIn}</p>
            <button className="wide primary" onClick={() => void play('global')} disabled={!!busy}>
              {busy === 'global' ? 'Entering…' : 'Enter'}
            </button>
          </section>

          <section className="option">
            <h3>Invitations</h3>
            <p>Friends who are playing their world right now and asked you in.</p>
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
        <p className="fine">Up to 4 players in a world. The server runs every world and saves it — your friends can keep playing in yours after you leave.</p>
      </div>
    </div>
  )
}
