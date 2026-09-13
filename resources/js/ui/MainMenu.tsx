/**
 * Lobby for the signed-in player: Join a game (room code) / Host a game / Play
 * solo, plus the cloud save and leaderboard. The user, the leaderboard and the
 * cloud-save summary are Inertia props from PlayController.
 */
import { useEffect, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession } from '../net/ClientSession'
import { isRoomCode, normalizeRoomCode } from '../net/protocol'
import { api } from '../net/api'
import type { PlayProps } from '../net/pageProps'
import { CLOUD_SLOT } from '../game/Game'
import { formatTime } from '../game/score'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function MainMenu() {
  const { auth, leaderboard, cloudSave } = usePage<PlayProps>().props
  const user = auth.user
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'host' | 'join' | 'load'>('')
  const [error, setError] = useState('')

  // the leaderboard and cloud save change while a run is in progress (dawn autosave,
  // scores); pull fresh copies whenever the menu comes back
  useEffect(() => {
    router.reload({ only: ['leaderboard', 'cloudSave'] })
  }, [])

  const playerName = user.name

  const solo = () => start({ role: 'host', name: playerName, session: new HostSession() })

  const host = async () => {
    setBusy('host')
    setError('')
    const session = new HostSession()
    try {
      await session.listen(playerName)
      start({ role: 'host', name: playerName, session })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  const join = async () => {
    const c = normalizeRoomCode(code)
    if (!isRoomCode(c)) { setError('Enter the 6-letter room code'); return }
    setBusy('join')
    setError('')
    const session = new ClientSession(c, playerName)
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

  const continueSave = async () => {
    setBusy('load')
    setError('')
    try {
      const restore = await api.loadGame(CLOUD_SLOT)
      start({ role: 'host', name: playerName, session: new HostSession(), restore })
    } catch (e) {
      setError(errorText(e))
      setBusy('')
    }
  }

  return (
    <div className="menu">
      <div className="menu-card">
        <h1>Block Survival</h1>
        <p className="tagline">Build by day. Hold the line by night.</p>

        <p className="account-line">
          Signed in as <b>{user.name}</b> ·{' '}
          <button className="link" onClick={() => router.post('/logout')}>sign out</button>
        </p>

        <div className="lobby">
          <section className="option">
            <h3>Join a game</h3>
            <p>Enter the room code your host shares.</p>
            <div className="join">
              <input
                value={code}
                placeholder="ROOM CODE"
                maxLength={6}
                aria-label="Room code"
                onChange={e => setCode(normalizeRoomCode(e.target.value))}
                onKeyDown={e => { if (e.key === 'Enter') void join() }}
              />
              <button onClick={join} disabled={!!busy || code.length < 6}>{busy === 'join' ? 'Joining…' : 'Join'}</button>
            </div>
          </section>

          <section className="option">
            <h3>Host a game</h3>
            <p>Open a room and share its code with up to 3 friends.</p>
            <button className="wide" onClick={host} disabled={!!busy}>{busy === 'host' ? 'Opening room…' : 'Host a game'}</button>
          </section>

          <section className="option">
            <h3>Play solo</h3>
            <p>Just you against the night.</p>
            <button className="wide primary" onClick={solo} disabled={!!busy}>Play solo</button>
            {cloudSave && (
              <button className="wide" onClick={continueSave} disabled={!!busy}>
                {busy === 'load' ? 'Loading…' : `Continue cloud save · night ${cloudSave.night} · ${formatTime(cloudSave.seconds)}`}
              </button>
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
