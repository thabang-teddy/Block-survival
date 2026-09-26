/**
 * The Windows installer for the PC that runs global worlds: the newest GitHub Release
 * built by host-app-release.yml. Downloading goes through the site
 * (/admin/host-app/download), which redirects to the release's MSI.
 */
import { usePage } from '@inertiajs/react'
import type { AdminHostsProps } from '../../net/pageProps'
import { timeAgo } from '../../game/score'

export function HostAppCard() {
  const { hostApp } = usePage<AdminHostsProps>().props

  return (
    <section className="admin-panel narrow host-app-card" aria-labelledby="host-app-heading">
      <header>
        <h2 id="host-app-heading">Block Survival Host for Windows</h2>
        <p>
          Install it on the PC that runs your global worlds. Its setup asks for the site&apos;s address and a host token from
          the list below, then runs each world as a Windows service.
        </p>
      </header>
      {hostApp ? (
        <div className="host-app-download">
          <a className="button primary" href="/admin/host-app/download">
            Download {hostApp.version} <small>({Math.round(hostApp.size / 1024 / 1024)} MB, .msi)</small>
          </a>
          <p className="fine">
            Released {hostApp.published_at ? timeAgo(hostApp.published_at) : 'recently'} ·{' '}
            <a className="link" href={hostApp.page} target="_blank" rel="noreferrer">release notes</a>. Unsigned for now:
            Windows may ask you to confirm, and Smart App Control can block it.
          </p>
        </div>
      ) : (
        <p className="empty">
          No installer released yet. Run the <b>Release host-app</b> workflow on GitHub (or push a <code>host-app-v1.0.0</code>{' '}
          tag) and it appears here.
        </p>
      )}
    </section>
  )
}
