/**
 * Inertia bootstrap. Pages live in inertia/Pages: Login, PendingApproval, Play (the game) and Admin/*.
 */
import { createInertiaApp, type ResolvedComponent } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'

const pages = import.meta.glob<ResolvedComponent>('./Pages/**/*.tsx')

void createInertiaApp({
  title: title => (title ? `${title} · Block Survival` : 'Block Survival'),
  resolve: name => {
    const page = pages[`./Pages/${name}.tsx`]
    if (!page) throw new Error(`Unknown page: ${name}`)
    return page()
  },
  setup({ el, App, props }) {
    createRoot(el).render(
      <StrictMode>
        <App {...props} />
      </StrictMode>,
    )
  },
})
