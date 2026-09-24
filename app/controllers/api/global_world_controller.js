import rooms from '#game-server/registry';
const HOSTED_BY_SERVER = 'The global world is hosted by the server now — enter it from the web client.';
export default class GlobalWorldController {
    async presence() {
        return rooms.presence();
    }
    async join({ response }) {
        return response.conflict({ message: HOSTED_BY_SERVER });
    }
    async claim({ response }) {
        return response.conflict({ message: HOSTED_BY_SERVER });
    }
    async leave() {
        return { ok: true };
    }
}
//# sourceMappingURL=global_world_controller.js.map