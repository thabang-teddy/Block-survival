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
import { parseRules, setCurrentRules } from '../game/rules'
import type { PlayProps } from '../net/pageProps'

export default function Play() {
  const { auth, rules } = usePage<PlayProps>().props
  // the game's API client needs to know whether it may post scores / autosave
  useEffect(() => { api.setUser(auth.user) }, [auth.user])
  // the admin's clock and zombie schedule, before any Game is built
  setCurrentRules(parseRules(rules))

  return (
    <>
      <Scene />
      <Hud />
    </>
  )
}
