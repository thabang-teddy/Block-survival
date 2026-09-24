import app from '@adonisjs/core/services/app';
import server from '@adonisjs/core/services/server';
import { attachGameSockets } from '#game-server/socket_server';
import rooms from '#game-server/registry';
app.ready(() => {
    const node = server.getNodeServer();
    if (node)
        attachGameSockets(node);
    rooms.startSweeping();
});
app.terminating(async () => {
    await rooms.shutdown();
});
//# sourceMappingURL=game.js.map