/**
 * Main menu: name, then Play solo / Host a game (room code) / Join with a code,
 * plus the optional account (leaderboard + cloud saves). Hosting starts the run
 * immediately; the code is registered in the background.
 */
import { useEffect, useState } from 'react'
import { useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession } from '../net/ClientSession'
import { isRoomCode, normalizeRoomCode } from '../net/protocol'
import { api, ApiError, type ApiUser, type LeaderboardRow, type SaveMeta } from '../net/api'
import { CLOUD_SLOT } from '../game/Game'
import { formatTime } from '../game/score'

const NAME_KEY = 'block-survival:name'

function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function MainMenu() {
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [name, setName] = useState(loadName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'host' | 'join' | 'load'>('')
  const [error, setError] = useState('')
  const [user, setUser] = useState<ApiUser | null>(api.user)
  const [cloudSave, setCloudSave] = useState<SaveMeta | null>(null)
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ }
  }, [name])

  // leaderboard + cloud save are optional extras: failures just leave them blank
  useEffect(() => {
    let cancelled = false
    api.leaderboard().then(rows => { if (!cancelled) setBoard(rows) }).catch(() => { if (!cancelled) setBoard(null) })
    if (user) {
      api.listSaves().then(saves => { if (!cancelled) setCloudSave(saves.find(s => s.slot === CLOUD_SLOT) ?? null) })
        .catch((e: unknown) => { if (!cancelled && e instanceof ApiError && e.status === 401) setUser(null) })
    } else {
      setCloudSave(null)
    }
    return () => { cancelled = true }
  }, [user])

  const playerName = (user?.name ?? name).trim() || 'Survivor'

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

        {user ? (
          <p className="account-line">
            Signed in as <b>{user.name}</b> ·{' '}
            <button className="link" onClick={() => api.logout().then(() => setUser(null))}>sign out</button>
          </p>
        ) : (
          <label className="field">
            <span>Your name</span>
            <input value={name} maxLength={16} placeholder="Survivor" onChange={e => setName(e.target.value)} />
          </label>
        )}

        <div className="menu-actions">
          <button className="primary" onClick={solo} disabled={!!busy}>Play solo</button>
          <button onClick={host} disabled={!!busy}>{busy === 'host' ? 'Opening room…' : 'Host a game'}</button>
        </div>
        {cloudSave && (
          <button className="wide" onClick={continueSave} disabled={!!busy}>
            {busy === 'load' ? 'Loading…' : `Continue cloud save · night ${cloudSave.night} · ${formatTime(cloudSave.seconds)}`}
          </button>
        )}
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

        {!user && (
          <p className="account-line">
            <button className="link" onClick={() => setAccountOpen(o => !o)}>
              {accountOpen ? 'Hide account' : 'Sign in or register'}
            </button>{' '}
            <span className="fine-inline">for the leaderboard and cloud saves</span>
          </p>
        )}
        {!user && accountOpen && <AccountForm defaultName={name} onSignedIn={u => { setUser(u); setAccountOpen(false) }} />}

        {board && board.length > 0 && (
          <div className="board">
            <h3>Leaderboard</h3>
            <ol>
              {board.slice(0, 8).map((r, i) => (
                <li key={i}><span>{r.name}</span><b>{r.score}</b></li>
              ))}
            </ol>
          </div>
        )}
        <p className="fine">Up to 4 players. The host's browser runs the world — if the host leaves, the match ends.</p>
      </div>
    </div>
  )
}

function AccountForm({ defaultName, onSignedIn }: { defaultName: string; onSignedIn: (u: ApiUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const u = mode === 'login' ? await api.login(email, password) : await api.register(name.trim(), email, password)
      onSignedIn(u)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account" onSubmit={e => { e.preventDefault(); void submit() }}>
      <div className="tabs">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button>
      </div>
      {mode === 'register' && (
        <input value={name} maxLength={16} placeholder="Player name" autoComplete="username" onChange={e => setName(e.target.value)} />
      )}
      <input type="email" value={email} placeholder="Email" autoComplete="email" onChange={e => setEmail(e.target.value)} />
      <input type="password" value={password} placeholder="Password (8+)" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={e => setPassword(e.target.value)} />
      <button type="submit" className="primary" disabled={busy || !email || password.length < 8}>
        {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
