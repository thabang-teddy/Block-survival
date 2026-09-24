import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import logger from '@adonisjs/core/services/logger';
import { encode } from '#game/net/protocol';
import rooms from '#game-server/registry';
export const SOCKET_PATH = '/ws';
const MAX_MESSAGE_BYTES = 64 * 1024;
const attached = new WeakSet();
const toBytes = (data) => Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
export function attachGameSockets(server) {
    if (attached.has(server))
        return;
    attached.add(server);
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== SOCKET_PATH) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => void onSocket(ws, url.searchParams.get('ticket')));
    });
}
async function onSocket(ws, ticket) {
    ws.binaryType = 'nodebuffer';
    const peer = {
        id: randomUUID(),
        send: (bytes) => {
            if (ws.readyState === ws.OPEN)
                ws.send(bytes);
        },
        close: () => {
            if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)
                ws.close();
        },
    };
    const early = [];
    let room;
    ws.on('message', (data) => {
        const bytes = toBytes(data);
        if (room)
            room.receive(peer, bytes);
        else if (early.length < 32)
            early.push(bytes);
    });
    ws.on('close', () => {
        try {
            room?.disconnect(peer);
        }
        catch (err) {
            logger.error({ err }, 'a player leaving failed');
        }
    });
    ws.on('error', (err) => logger.debug({ err }, 'game socket error'));
    const admitted = await rooms.admit(peer, ticket).catch((err) => {
        logger.error({ err }, 'admitting a game socket failed');
        return { refusal: 'The server could not seat you — try again.' };
    });
    if ('refusal' in admitted) {
        if (ws.readyState === ws.OPEN)
            ws.send(encode({ t: 'state', message: admitted.refusal }));
        ws.close();
        return;
    }
    room = admitted.room;
    if (ws.readyState !== ws.OPEN) {
        room.disconnect(peer);
        return;
    }
    for (const bytes of early.splice(0))
        room.receive(peer, bytes);
}
//# sourceMappingURL=socket_server.js.map