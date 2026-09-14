/**
 * Lobby for the signed-in player: Join a game (pick an open room) / Host a game /
 * Play solo, plus the leaderboard. Every player has one world: solo and hosted
 * games continue it, and "start over" wipes it. The user, the leaderboard and
 * the world summary are Inertia props from PlayController; the open-rooms list
 * is polled from /api/rooms.
 */
import { useEffect, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession } from '../net/ClientSession'
import { isRoomCode } from '../net/protocol'
import { api, type SaveData } from '../net/api'
import type { PlayProps } from '../net/pageProps'
import { formatTime, timeAgo } from '../game/score'
import { useOpenRooms } from './useOpenRooms'
import { seatsText } from './openGames'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function MainMenu() {
  const { auth, leaderboard, world } = usePage<PlayProps>().props
  const user = auth.user
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [joining, setJoining] = useState('')
  const [busy, setBusy] = useState<'' | 'host' | 'join' | 'solo' | 'reset'>('')
  const [error, setError] = useState('')
  const openRooms = useOpenRooms(!busy)

  // the leaderboard and the world change while a run is in progress (dawn autosave,
  // scores); pull fresh copies whenever the menu comes back
  useEffect(() => {
    router.reload({ only: ['leaderboard', 'world'] })
  }, [])

  const playerName = user.name

  /** the saved world, if there is one; the host's game continues from it */
  const restore = async (): Promise<SaveData | undefined> => (world ? (await api.loadWorld()) ?? undefined : undefined)

  const solo = async () => {
    setBusy('solo')
    setError('')
    try {
      start({ role: 'host', name: playerName, session: new HostSession(), restore: await restore() })
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
      await session.listen(playerName)
      start({ role: 'host', name: playerName, session, restore: saved })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  const join = async (code: string) => {
    if (!isRoomCode(code)) { setError('That room is gone'); return }
    setJoining(code)
    setBusy('join')
    setError('')
    const session = new ClientSession(code, playerName)
    session.onStatus = st => {
      if (st === 'host-left') setNetStatus('host-left')
      else if (st === 'error') setNetStatus('error', session.error)
    }
    try {
      await session.connect()
      start({ role: 'client', name: playerName, session })
    } catch (e) {
      session.dispose()
      setError(errorText(e))
      setBusy('')
    }
  }

  const startOver = async () => {
    if (!confirm('Delete your world and start from a fresh island? This cannot be undone.')) return
    setBusy('reset')
    setError('')
    try {
      await api.resetWorld()
      router.reload({ only: ['world'] })
    } catch (e) {
      setError(errorText(e))
    }
    setBusy('')
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
          <section className="option">
            <h3>Join a game</h3>
            <p>Pick a game someone is hosting right now.</p>
            <ul className="open-games" aria-label="Open games">
              {openRooms.rooms.map(r => (
                <li key={r.code}>
                  <span className="host">{r.host_name}</span>
                  <span className="seats">{seatsText(r)}</span>
                  <button onClick={() => void join(r.code)} disabled={!!busy}>
                    {busy === 'join' && joining === r.code ? 'Joining…' : 'Join'}
                  </button>
                </li>
              ))}
              {openRooms.loaded && openRooms.rooms.length === 0 && (
                <li className="empty">{openRooms.error ? `Could not load games: ${openRooms.error}` : 'No open games right now'}</li>
              )}
            </ul>
          </section>

          <section className="option">
            <h3>Your world</h3>
            <p>
              {world
                ? `Night ${world.night} · ${formatTime(world.seconds)} survived · ${world.players} player${world.players === 1 ? '' : 's'} have played · saved ${timeAgo(world.updated_at)}. Solo and hosted games continue it.`
                : 'A fresh world — it saves itself every minute, at dawn, and when you leave.'}
            </p>
            <button className="wide primary" onClick={solo} disabled={!!busy}>{busy === 'solo' ? 'Loading…' : 'Play solo'}</button>
            <button className="wide" onClick={host} disabled={!!busy}>{busy === 'host' ? 'Opening room…' : 'Host a game for up to 3 friends'}</button>
            {world && (
              <p className="fine">
                <button className="link" onClick={startOver} disabled={!!busy}>{busy === 'reset' ? 'Resetting…' : 'Start over with a new island'}</button>
              </p>
            )}
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
        <p className="fine">Up to 4 players. The host&apos;s browser runs the world — if the host leaves, the match ends.</p>
      </div>
    </div>
  )
}
