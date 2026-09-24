import { readFile } from 'node:fs/promises';
import vine from '@vinejs/vine';
import World from '#models/world';
import { readBody, storeWorld } from '#services/world_store';
import rooms from '#game-server/registry';
const metaValidator = vine.create({
    night: vine.number().withoutDecimals().min(0).optional(),
    seconds: vine.number().withoutDecimals().min(0).optional(),
});
export default class WorldController {
    async update(ctx) {
        if (refused(ctx))
            return;
        const meta = await ctx.request.validateUsing(metaValidator, { data: ctx.request.qs() });
        const bytes = await readBody(ctx.request.request, World.MAX_BYTES);
        return store(ctx, bytes, meta);
    }
    async beacon(ctx) {
        if (refused(ctx))
            return;
        const meta = await ctx.request.validateUsing(metaValidator);
        const file = ctx.request.file('payload');
        if (!file?.tmpPath)
            return ctx.response.unprocessableEntity({ message: 'The payload field is required.', errors: { payload: ['The payload field is required.'] } });
        return store(ctx, await readFile(file.tmpPath), meta);
    }
    async show({ params, response, auth }) {
        const kind = params.kind ?? World.OWN;
        if (!World.isKind(kind))
            return response.notFound({ message: 'Not Found' });
        const world = kind === World.GLOBAL ? await World.global() : await World.ownOf(auth.user.id);
        if (!world)
            return response.notFound({ message: 'No world yet.' });
        response.header('Content-Type', 'application/gzip');
        response.header('X-Save-Night', String(world.night));
        response.header('X-Save-Seconds', String(world.seconds));
        return response.send(world.bytes());
    }
    async destroy({ auth }) {
        const user = auth.user;
        await rooms.closeOwn(user.id, 'The world was reset.', { save: false });
        await World.query().where('user_id', user.id).where('kind', World.OWN).delete();
        return { ok: true };
    }
}
function refused({ params, response, auth }) {
    const kind = params.kind ?? World.OWN;
    if (!World.isKind(kind)) {
        response.notFound({ message: 'Not Found' });
        return true;
    }
    if (kind === World.GLOBAL) {
        response.conflict({ message: 'The global world is hosted by the server.' });
        return true;
    }
    if (rooms.ownRoomOf(auth.user.id)) {
        response.conflict({ message: 'Your world is running on the server right now — leave it before saving from here.' });
        return true;
    }
    return false;
}
async function store({ response, auth }, bytes, meta) {
    const result = await storeWorld(auth.user.id, World.OWN, bytes, meta.night ?? 0, meta.seconds ?? 0);
    if ('error' in result)
        return response.status(result.status).send({ message: result.error });
    return { world: result.world.meta() };
}
//# sourceMappingURL=world_controller.js.map