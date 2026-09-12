/**
 * Main menu: name, then Play solo / Host a game (room code) / Join with a code,
 * plus the optional account (leaderboard + cloud saves). The signed-in user, the
 * leaderboard and the cloud-save summary are Inertia props from PlayController;
 * sign-in / register / sign-out are Inertia form posts to the session routes.
 */
import { useEffect, useState } from 'react'
import { router, useForm, usePage } from '@inertiajs/react'
import { useUiStore } from '../state/uiStore'
import { HostSession } from '../net/HostSession'
import { ClientSession } from '../net/ClientSession'
import { isRoomCode, normalizeRoomCode } from '../net/protocol'
import { api } from '../net/api'
import type { PlayProps } from '../net/pageProps'
import { CLOUD_SLOT } from '../game/Game'
import { formatTime } from '../game/score'

const NAME_KEY = 'block-survival:name'

function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function MainMenu() {
  const { auth, leaderboard, cloudSave } = usePage<PlayProps>().props
  const user = auth.user
  const start = useUiStore(s => s.start)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [name, setName] = useState(loadName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'host' | 'join' | 'load'>('')
  const [error, setError] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ }
  }, [name])

  // the leaderboard and cloud save change while a run is in progress (dawn autosave,
  // scores); pull fresh copies whenever the menu comes back
  useEffect(() => {
    router.reload({ only: ['leaderboard', 'cloudSave'] })
  }, [])

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
            <button className="link" onClick={() => router.post('/logout')}>sign out</button>
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
        {user && cloudSave && (
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
        {!user && accountOpen && <AccountForm defaultName={name} />}

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
        <p className="fine">Up to 4 players. The host's browser runs the world — if the host leaves, the match ends.</p>
      </div>
    </div>
  )
}

function AccountForm({ defaultName }: { defaultName: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const form = useForm({ name: defaultName, email: '', password: '' })
  const error = form.errors.email ?? form.errors.password ?? form.errors.name

  const submit = () => {
    form.clearErrors()
    form.post(mode === 'login' ? '/login' : '/register', { preserveScroll: true })
  }

  return (
    <form className="account" onSubmit={e => { e.preventDefault(); submit() }}>
      <div className="tabs">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button>
      </div>
      {mode === 'register' && (
        <input value={form.data.name} maxLength={16} placeholder="Player name" autoComplete="username" onChange={e => form.setData('name', e.target.value)} />
      )}
      <input type="email" value={form.data.email} placeholder="Email" autoComplete="email" onChange={e => form.setData('email', e.target.value)} />
      <input type="password" value={form.data.password} placeholder="Password (8+)" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={e => form.setData('password', e.target.value)} />
      <button type="submit" className="primary" disabled={form.processing || !form.data.email || form.data.password.length < 8}>
        {form.processing ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
