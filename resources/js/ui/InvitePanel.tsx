/**
 * The host's invitation list on the pause screen (issue #5): every other player with
 * an Invite button and where they stand — invited, accepted, joined, declined. Polls
 * the room's invites only while it is open.
 */
import { useEffect, useState } from 'react'
import { api, type HostInvite, type PlayerRow } from '../net/api'
import { INVITES_POLL_MS } from './invites'

interface Props {
  code: string
  /** names of the players currently in the match (besides the host) */
  joinedNames: readonly string[]
  onClose: () => void
}

type Status = 'invite' | 'pending' | 'accepted' | 'joined' | 'declined'

export function statusOf(player: PlayerRow, invites: readonly HostInvite[], joinedNames: readonly string[]): Status {
  if (joinedNames.includes(player.name)) return 'joined'
  const inv = invites.find(i => i.user_id === player.id)
  if (!inv) return 'invite'
  return inv.status
}

const LABEL: Record<Status, string> = { invite: '', pending: 'invited', accepted: 'accepted', joined: 'joined', declined: 'declined' }

export function InvitePanel({ code, joinedNames, onClose }: Props) {
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [invites, setInvites] = useState<HostInvite[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api.players().then(p => { if (!cancelled) setPlayers(p) }).catch(e => setError(e instanceof Error ? e.message : String(e)))
    const tick = () => api.roomInvites(code).then(i => { if (!cancelled) setInvites(i) }).catch(() => {})
    void tick()
    const timer = setInterval(() => { void tick() }, INVITES_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [code])

  const invite = async (p: PlayerRow) => {
    setBusy(p.id)
    setError('')
    try {
      const inv = await api.invite(code, p.id)
      setInvites(list => [...list.filter(i => i.user_id !== inv.user_id), inv])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
  }

  return (
    <div className="invite-panel" onClick={e => e.stopPropagation()}>
      <header>
        <h3>Invite players</h3>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <ul aria-label="Players">
        {players.map(p => {
          const st = statusOf(p, invites, joinedNames)
          return (
            <li key={p.id}>
              <span className="name">{p.name}</span>
              {st === 'invite' || st === 'declined' ? (
                <button onClick={() => void invite(p)} disabled={busy === p.id}>
                  {busy === p.id ? 'Inviting…' : st === 'declined' ? 'Invite again' : 'Invite'}
                </button>
              ) : (
                <span className={`tag ${st}`}>{LABEL[st]}</span>
              )}
            </li>
          )
        })}
        {players.length === 0 && <li className="empty">{error || 'No other players yet — an admin creates accounts.'}</li>}
      </ul>
      {error && players.length > 0 && <p className="error">{error}</p>}
    </div>
  )
}
