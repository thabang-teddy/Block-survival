/**
 * Laravel Echo over Reverb, created on first use so solo play never opens a socket.
 * Configuration comes from the VITE_REVERB_* variables Laravel exposes.
 */
import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

type ReverbEcho = Echo<'reverb'>

let instance: ReverbEcho | null = null

export function echo(): ReverbEcho {
  if (instance) return instance
  const env = import.meta.env
  const scheme = (env.VITE_REVERB_SCHEME as string | undefined) ?? 'http'
  const port = Number(env.VITE_REVERB_PORT ?? (scheme === 'https' ? 443 : 80))
  instance = new Echo({
    broadcaster: 'reverb',
    Pusher,
    key: env.VITE_REVERB_APP_KEY as string,
    wsHost: (env.VITE_REVERB_HOST as string | undefined) ?? window.location.hostname,
    wsPort: port,
    wssPort: port,
    forceTLS: scheme === 'https',
    enabledTransports: ['ws', 'wss'],
  })
  return instance
}

/** the current socket id, so the relay can skip echoing our own messages back */
export const socketId = (): string | undefined => instance?.socketId()
