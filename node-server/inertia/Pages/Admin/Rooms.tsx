/** Live rooms page. */
import { usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { RoomsPanel } from '../../ui/admin/RoomsPanel'
import type { AdminRoomsProps } from '../../net/pageProps'

export default function Rooms() {
  const { rooms } = usePage<AdminRoomsProps>().props

  return (
    <AdminLayout title="Rooms" refresh={['rooms']}>
      <RoomsPanel rooms={rooms} />
    </AdminLayout>
  )
}
