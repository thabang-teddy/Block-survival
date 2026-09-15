/** PC approval page. */
import { usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { DevicesPanel } from '../../ui/admin/DevicesPanel'
import type { AdminDevicesProps } from '../../net/pageProps'

export default function Devices() {
  const { devices } = usePage<AdminDevicesProps>().props

  return (
    <AdminLayout title="PCs" refresh={['devices']}>
      <DevicesPanel devices={devices} />
    </AdminLayout>
  )
}
