/**
 * Main menu: name, then Play solo / Host a game (room code) / Join with a code.
 * Hosting starts the run immediately; the code is registered in the background and
 * shown in the HUD once the signalling server accepts it.
 */
import { useEffect, useState } from 'react'
import { useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession } from '../net/ClientSession'
import { isRoomCode, normalizeRoomCode } from '../net/protocol'

const NAME_KEY = 'block-survival:name'

function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}

export function MainMenu() {
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [name, setName] = useState(loadName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'host' | 'join'>('')
  const [error, setError] = useState('')

  useEffect(() => {
    try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ }
  }, [name])

  const playerName = name.trim() || 'Survivor'

  const solo = () => start({ role: 'host', name: playerName, session: new HostSession() })

  const host = async () => {
    setBusy('host')
    setError('')
    const session = new HostSession()
    try {
      await session.listen()
      start({ role: 'host', name: playerName, session })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      setError(e instanceof Error ? e.message : String(e))
      setBusy('')
    }
  }

  return (
    <div className="menu">
      <div className="menu-card">
        <h1>Block Survival</h1>
        <p className="tagline">Build by day. Hold the line by night.</p>
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="Survivor" onChange={e => setName(e.target.value)} />
        </label>
        <div className="menu-actions">
          <button className="primary" onClick={solo} disabled={!!busy}>Play solo</button>
          <button onClick={host} disabled={!!busy}>{busy === 'host' ? 'Opening room…' : 'Host a game'}</button>
        </div>
        <div className="join">
          <input
            value={code}
            placeholder="ROOM CODE"
            maxLength={6}
            onChange={e => setCode(normalizeRoomCode(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') void join() }}
          />
          <button onClick={join} disabled={!!busy || code.length < 6}>{busy === 'join' ? 'Joining…' : 'Join'}</button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="fine">Up to 4 players. The host's browser runs the world — if the host leaves, the match ends.</p>
      </div>
    </div>
  )
}
