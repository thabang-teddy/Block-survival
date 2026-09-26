/** Host PCs page: every host key, one per global world. */
import { usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { HostKeysPanel } from '../../ui/admin/HostKeysPanel'
import type { AdminHostsProps } from '../../net/pageProps'

export default function Hosts() {
  const { hosts } = usePage<AdminHostsProps>().props

  return (
    <AdminLayout title="Host PCs" refresh={['hosts']}>
      <HostKeysPanel hosts={hosts} />
    </AdminLayout>
  )
}
