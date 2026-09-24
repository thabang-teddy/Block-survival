import { randomUUID } from 'node:crypto'
import type { Server as HttpServer } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import logger from '@adonisjs/core/services/logger'
import { encode } from '#game/net/protocol'
import rooms from '#game-server/registry'
import type { GameRoom, Peer } from '#game-server/game_room'

export const SOCKET_PATH = '/ws'
/** a game message is small; a hostile client must not make the server buffer megabytes */
const MAX_MESSAGE_BYTES = 64 * 1024

const attached = new WeakSet<object>()

const toBytes = (data: RawData): Uint8Array =>
  Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data

/**
 * The game's WebSocket endpoint: `GET /ws?ticket=…` upgrades when the ticket (issued by
 * /api/play or /api/rooms/:code/join a moment earlier) is valid, and the socket becomes
 * that player's link to their room. Everything after that is binary msgpack.
 */
export function attachGameSockets(server: HttpServer | HttpsServer): void {
  if (attached.has(server)) return
  attached.add(server)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== SOCKET_PATH) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => void onSocket(ws, url.searchParams.get('ticket')))
  })
}

async function onSocket(ws: WebSocket, ticket: string | null): Promise<void> {
  ws.binaryType = 'nodebuffer'
  const peer: Peer = {
    id: randomUUID(),
    send: (bytes) => {
      if (ws.readyState === ws.OPEN) ws.send(bytes)
    },
    close: () => ws.close(),
  }
  // messages that arrive while the ticket is checked are held, then replayed
  const early: Uint8Array[] = []
  let room: GameRoom | undefined
  ws.on('message', (data) => {
    const bytes = toBytes(data)
    if (room) room.receive(peer, bytes)
    else if (early.length < 32) early.push(bytes)
  })
  ws.on('close', () => room?.disconnect(peer))
  ws.on('error', (err) => logger.debug({ err }, 'game socket error'))

  const admitted = await rooms.admit(peer, ticket).catch((err) => {
    logger.error({ err }, 'admitting a game socket failed')
    return { refusal: 'The server could not seat you — try again.' }
  })
  if ('refusal' in admitted) {
    if (ws.readyState === ws.OPEN) ws.send(encode({ t: 'state', message: admitted.refusal }))
    ws.close()
    return
  }
  room = admitted.room
  // the socket may have gone while the ticket was checked
  if (ws.readyState !== ws.OPEN) {
    room.disconnect(peer)
    return
  }
  for (const bytes of early.splice(0)) room.receive(peer, bytes)
}
