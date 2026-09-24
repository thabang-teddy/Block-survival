import rooms, { RoomRefusal } from '#game-server/registry';
export default class GlobalWorldController {
    async handle({ response, session }) {
        try {
            await rooms.resetGlobal();
            session.flash('status', 'The global world was reset.');
        }
        catch (e) {
            if (!(e instanceof RoomRefusal))
                throw e;
            session.flash('status', e.message);
        }
        return response.redirect().back();
    }
}
//# sourceMappingURL=global_world_controller.js.map