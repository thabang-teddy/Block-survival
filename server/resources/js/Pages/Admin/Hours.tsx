/** Operating hours page. */
import { usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { LoginWindowPanel } from '../../ui/admin/LoginWindowPanel'
import type { AdminHoursProps } from '../../net/pageProps'

export default function Hours() {
  const { loginWindow, timezones } = usePage<AdminHoursProps>().props

  return (
    <AdminLayout title="Hours">
      <LoginWindowPanel key={JSON.stringify(loginWindow)} initial={loginWindow} timezones={timezones} />
    </AdminLayout>
  )
}
