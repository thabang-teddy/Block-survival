/** Game rules page: the day/night clock and the zombie schedule. */
import { usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { GameRulesPanel } from '../../ui/admin/GameRulesPanel'
import type { AdminRulesProps } from '../../net/pageProps'

export default function Rules() {
  const { rules, defaults, bounds } = usePage<AdminRulesProps>().props

  return (
    <AdminLayout title="Rules">
      <GameRulesPanel key={JSON.stringify(rules)} initial={rules} defaults={defaults} bounds={bounds} />
    </AdminLayout>
  )
}
