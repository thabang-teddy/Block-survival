import env from '#start/env'
import app from '@adonisjs/core/services/app'

/**
 * The admin account from the environment, device approval and the dev guest sign-in
 * (the Laravel app's config/admin.php).
 */
const adminConfig = {
  /**
   * `node ace admin:sync` creates or updates this account and marks it as an admin. A
   * user with this email is treated as an admin even before the sync runs, so the
   * account can never be locked out of the admin section.
   */
  email: env.get('ADMIN_EMAIL') ?? '',
  password: env.get('ADMIN_PASSWORD') ?? '',
  name: env.get('ADMIN_NAME') ?? 'Admin',

  /** the encrypted cookie that names a browser's device row */
  deviceCookie: 'bs_device',
  /** a browser that never gets approved is forgotten after this long */
  devicePendingDays: 30,

  /**
   * The sign-in page's "guest" button: creates a throwaway account on first click and
   * signs in as it from then on, approving the browser on the spot. Development only
   * unless GUEST_LOGIN says otherwise — the button is hidden and the route 404s elsewhere.
   */
  guestLogin: env.get('GUEST_LOGIN') ?? app.inDev,
}

export default adminConfig
