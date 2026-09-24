/*
|--------------------------------------------------------------------------
| The game server
|--------------------------------------------------------------------------
|
| The WebSocket endpoint rides on the HTTP server (app/game/socket_server.ts), empty
| rooms are swept, and every running world is saved before the process exits. Tests
| attach the sockets to their own HTTP server (tests/bootstrap.ts).
|
*/

import app from '@adonisjs/core/services/app'
import server from '@adonisjs/core/services/server'
import { attachGameSockets } from '#game-server/socket_server'
import rooms from '#game-server/registry'

app.ready(() => {
  const node = server.getNodeServer()
  if (node) attachGameSockets(node)
  rooms.startSweeping()
})

app.terminating(async () => {
  await rooms.shutdown()
})
