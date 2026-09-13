/**
 * The game page (login-only). Menu data (signed-in user, leaderboard, cloud save)
 * comes from the PlayController as Inertia props; the running game talks to /api
 * with the same session.
 */
import { useEffect } from 'react'
import { usePage } from '@inertiajs/react'
import { Scene } from '../render/Scene'
import { Hud } from '../ui/Hud'
import { api } from '../net/api'
import type { PlayProps } from '../net/pageProps'

export default function Play() {
  const { auth } = usePage<PlayProps>().props
  // the game's API client needs to know whether it may post scores / autosave
  useEffect(() => { api.setUser(auth.user) }, [auth.user])

  return (
    <>
      <Scene />
      <Hud />
    </>
  )
}
