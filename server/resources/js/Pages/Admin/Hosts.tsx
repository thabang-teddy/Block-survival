/** Host PCs page: the Windows installer to download, then every host key, one per global world. */
import { Deferred, usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { HostAppCard } from '../../ui/admin/HostAppCard'
import { HostKeysPanel } from '../../ui/admin/HostKeysPanel'
import type { AdminHostsProps } from '../../net/pageProps'

export default function Hosts() {
  const { hosts } = usePage<AdminHostsProps>().props

  return (
    <AdminLayout title="Host PCs" refresh={['hosts']}>
      <Deferred data="hostApp" fallback={<section className="admin-panel narrow"><p className="empty">Looking up the Windows installer…</p></section>}>
        <HostAppCard />
      </Deferred>
      <HostKeysPanel hosts={hosts} />
    </AdminLayout>
  )
}
