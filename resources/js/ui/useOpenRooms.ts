/**
 * Polls /api/rooms while the lobby is on screen. Errors are swallowed into the
 * `error` string: the manual room-code input still works when the list does not.
 */
import { useEffect, useState } from 'react'
import { api, type OpenRoom } from '../net/api'
import { OPEN_ROOMS_POLL_MS, sortOpenRooms } from './openGames'

export interface OpenRoomsState {
  rooms: OpenRoom[]
  loaded: boolean
  error: string
}

export function useOpenRooms(enabled: boolean): OpenRoomsState {
  const [state, setState] = useState<OpenRoomsState>({ rooms: [], loaded: false, error: '' })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const tick = async () => {
      try {
        const rooms = sortOpenRooms(await api.listRooms())
        if (!cancelled) setState({ rooms, loaded: true, error: '' })
      } catch (e) {
        if (!cancelled) setState(s => ({ ...s, loaded: true, error: e instanceof Error ? e.message : String(e) }))
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, OPEN_ROOMS_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled])

  return state
}
