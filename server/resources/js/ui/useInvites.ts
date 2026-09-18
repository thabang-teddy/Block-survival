/**
 * Polls /api/invites while the lobby is on screen. Errors are swallowed into the
 * `error` string: the rest of the lobby still works when the list does not.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type Invite } from '../net/api'
import { INVITES_POLL_MS, sortInvites } from './invites'

export interface InvitesState {
  invites: Invite[]
  loaded: boolean
  error: string
  /** re-fetch now (after accepting or declining one) */
  refresh: () => void
}

export function useInvites(enabled: boolean): InvitesState {
  const [state, setState] = useState<Omit<InvitesState, 'refresh'>>({ invites: [], loaded: false, error: '' })
  const [tickCount, setTickCount] = useState(0)
  const refresh = useCallback(() => setTickCount(n => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const tick = async () => {
      try {
        const invites = sortInvites(await api.invites())
        if (!cancelled) setState({ invites, loaded: true, error: '' })
      } catch (e) {
        if (!cancelled) setState(s => ({ ...s, loaded: true, error: e instanceof Error ? e.message : String(e) }))
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, INVITES_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled, tickCount])

  return { ...state, refresh }
}
