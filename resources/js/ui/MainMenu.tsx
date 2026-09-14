/**
 * Lobby for the signed-in player. Two worlds to play — their own (a random seed) and
 * the shared global world (the classic seed; builds are per player) — each solo or
 * hosted for friends, plus the invitations other hosts have sent and the leaderboard.
 * The user, the leaderboard and the world summaries are Inertia props from
 * PlayController; invitations are polled from /api/invites (issue #5).
 */
import { useEffect, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession } from '../net/ClientSession'
import { api, type Invite, type SaveData, type WorldMeta } from '../net/api'
import type { PlayProps } from '../net/pageProps'
import { formatTime, timeAgo } from '../game/score'
import { GLOBAL_SEED, newWorldSeed, seedTag, type WorldKind } from '../world/seed'
import { useInvites } from './useInvites'
import { seatsText, worldLabel } from './invites'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type Busy = '' | `host:${WorldKind}` | `solo:${WorldKind}` | `reset:${WorldKind}` | `join:${number}`

export function MainMenu() {
  const { auth, leaderboard, worlds } = usePage<PlayProps>().props
  const user = auth.user
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [busy, setBusy] = useState<Busy>('')
  const [error, setError] = useState('')
  const invites = useInvites(!busy)

  // the leaderboard and the worlds change while a run is in progress (autosaves,
  // scores); pull fresh copies whenever the menu comes back
  useEffect(() => {
    router.reload({ only: ['leaderboard', 'worlds'] })
  }, [])

  const playerName = user.name

  /** the saved world of that kind, if there is one; the host's game continues from it */
  const restore = async (kind: WorldKind): Promise<SaveData | undefined> =>
    worlds[kind] ? (await api.loadWorld(kind)) ?? undefined : undefined

  /** what a brand-new world of that kind is generated from */
  const seedFor = (kind: WorldKind): number => (kind === 'global' ? GLOBAL_SEED : newWorldSeed())

  const solo = async (kind: WorldKind) => {
    setBusy(`solo:${kind}`)
    setError('')
    try {
      start({ role: 'host', name: playerName, session: new HostSession(), restore: await restore(kind), worldKind: kind, seed: seedFor(kind) })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  const host = async (kind: WorldKind) => {
    setBusy(`host:${kind}`)
    setError('')
    const session = new HostSession()
    try {
      const saved = await restore(kind)
      await session.listen(playerName, kind)
      start({ role: 'host', name: playerName, session, restore: saved, worldKind: kind, seed: seedFor(kind) })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  const accept = async (invite: Invite) => {
    setBusy(`join:${invite.id}`)
    setError('')
    const session = new ClientSession(invite.code, playerName)
    session.onStatus = st => {
      if (st === 'host-left') setNetStatus('host-left')
      else if (st === 'error') setNetStatus('error', session.error)
    }
    try {
      // accepting is what unlocks the room's peer id and mailbox for us
      await api.acceptInvite(invite.id)
      await session.connect()
      start({ role: 'client', name: playerName, session })
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

  const startOver = async (kind: WorldKind) => {
    const what = kind === 'global' ? 'your builds in the global world' : 'your world'
    if (!confirm(`Delete ${what} and start again? This cannot be undone.`)) return
    setBusy(`reset:${kind}`)
    setError('')
    try {
      await api.resetWorld(kind)
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

  const worldCard = (kind: WorldKind, title: string, blurb: string, fresh: string) => {
    const w = worlds[kind]
    return (
      <section className="option" key={kind}>
        <h3>{title}</h3>
        <p>{blurb}</p>
        <p className="fine">{summary(w, fresh)}</p>
        <button className="wide primary" onClick={() => void solo(kind)} disabled={!!busy}>
          {busy === `solo:${kind}` ? 'Loading…' : 'Play solo'}
        </button>
        <button className="wide" onClick={() => void host(kind)} disabled={!!busy}>
          {busy === `host:${kind}` ? 'Opening room…' : 'Host for friends'}
        </button>
        {w && (
          <p className="fine">
            <button className="link" onClick={() => void startOver(kind)} disabled={!!busy}>
              {busy === `reset:${kind}` ? 'Resetting…' : kind === 'global' ? 'Start over in the global world' : 'Start over with a new world'}
            </button>
          </p>
        )}
      </section>
    )
  }

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
          {worldCard('own', 'My world', 'Your own map, with its own seed — nobody visits without an invitation.',
            'A fresh world with a new seed — it saves itself every minute, at dawn, and when you leave.')}
          {worldCard('global', 'Global world', `The classic map (${seedTag(GLOBAL_SEED)}) everyone shares — the same terrain for all, your builds are yours.`,
            'You have not played the global world yet.')}

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
        <p className="fine">Up to 4 players. The host&apos;s browser runs the world — if the host leaves, the match ends. Invite friends from the pause screen once you are hosting.</p>
      </div>
    </div>
  )
}
