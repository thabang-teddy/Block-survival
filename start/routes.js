import router from '@adonisjs/core/services/router';
import { middleware } from '#start/kernel';
import { throttleApi, throttleLogin, throttlePoll, throttleSignal } from '#start/limiter';
const AuthController = () => import('#controllers/auth_controller');
const PendingApprovalController = () => import('#controllers/pending_approval_controller');
const PlayPageController = () => import('#controllers/play_controller');
const ApiAuthController = () => import('#controllers/api/auth_controller');
const ApiGameRulesController = () => import('#controllers/api/game_rules_controller');
const ApiGlobalWorldController = () => import('#controllers/api/global_world_controller');
const InviteController = () => import('#controllers/api/invite_controller');
const ApiPlayController = () => import('#controllers/api/play_controller');
const ApiRoomController = () => import('#controllers/api/room_controller');
const ScoreController = () => import('#controllers/api/score_controller');
const SignalController = () => import('#controllers/api/signal_controller');
const WorldController = () => import('#controllers/api/world_controller');
const DashboardController = () => import('#controllers/admin/dashboard_controller');
const DeviceController = () => import('#controllers/admin/device_controller');
const AdminGameRulesController = () => import('#controllers/admin/game_rules_controller');
const AdminGlobalWorldController = () => import('#controllers/admin/global_world_controller');
const LoginWindowController = () => import('#controllers/admin/login_window_controller');
const AdminRoomController = () => import('#controllers/admin/room_controller');
const UserController = () => import('#controllers/admin/user_controller');
router.get('/up', () => ({ status: 'ok' }));
router
    .group(() => {
    router.get('/login', [AuthController, 'show']).as('login');
    router.post('/login', [AuthController, 'login']).use(throttleLogin);
    router.post('/login/guest', [AuthController, 'guest']).use(throttleLogin);
    router.get('/pending-approval', [PendingApprovalController, 'show']);
    router.get('/pending-approval/status', [PendingApprovalController, 'status']).use(throttlePoll);
})
    .use(middleware.guest());
router
    .group(() => {
    router.post('/token', [ApiAuthController, 'token']).use(throttleLogin);
    router.post('/status', [ApiAuthController, 'status']).use(throttlePoll);
})
    .prefix('/api/auth');
router
    .group(() => {
    router.get('/', [PlayPageController, 'handle']).as('play');
    router.post('/logout', [AuthController, 'logout']).as('logout');
})
    .use([middleware.auth({ guards: ['web'] }), middleware.access()]);
router
    .group(() => {
    router
        .group(() => {
        router.get('/me', [ApiAuthController, 'me']);
        router.post('/logout', [ApiAuthController, 'logout']);
    })
        .prefix('/auth')
        .use(throttleApi);
    router
        .group(() => {
        router.post('/rooms/:code/signal', [SignalController, 'store']);
        router.get('/rooms/:code/signals', [SignalController, 'index']);
    })
        .use(throttleSignal);
    router
        .group(() => {
        router.post('/play', [ApiPlayController, 'play']);
        router.post('/rooms/:code/join', [ApiPlayController, 'join']);
        router.post('/rooms', [ApiRoomController, 'store']);
        router.get('/rooms/:code', [ApiRoomController, 'show']);
        router.patch('/rooms/:code', [ApiRoomController, 'update']);
        router.delete('/rooms/:code', [ApiRoomController, 'destroy']);
        router.get('/rooms/:code/invites', [InviteController, 'room']);
        router.post('/rooms/:code/invites', [InviteController, 'store']);
        router.get('/players', [InviteController, 'players']);
        router.get('/invites', [InviteController, 'index']);
        router.post('/invites/:invite/accept', [InviteController, 'accept']).where('invite', router.matchers.number());
        router.post('/invites/:invite/decline', [InviteController, 'decline']).where('invite', router.matchers.number());
        router.get('/leaderboard', [ScoreController, 'leaderboard']);
        router.post('/scores', [ScoreController, 'store']);
        router.get('/global/presence', [ApiGlobalWorldController, 'presence']);
        router.get('/rules', [ApiGameRulesController, 'handle']);
        router.post('/global/join', [ApiGlobalWorldController, 'join']);
        router.post('/global/claim', [ApiGlobalWorldController, 'claim']);
        router.post('/global/leave', [ApiGlobalWorldController, 'leave']);
        router.post('/world/beacon', [WorldController, 'beacon']);
        router.post('/world/:kind/beacon', [WorldController, 'beacon']).where('kind', /^(own|global)$/).as('world.beacon_kind');
        router.get('/world/:kind?', [WorldController, 'show']).where('kind', /^(own|global)$/);
        router.put('/world/:kind?', [WorldController, 'update']).where('kind', /^(own|global)$/);
        router.delete('/world/:kind?', [WorldController, 'destroy']).where('kind', /^own$/);
    })
        .use(throttleApi);
})
    .prefix('/api')
    .use([middleware.auth({ guards: ['web', 'api'] }), middleware.access()]);
router
    .group(() => {
    router.get('/', [DashboardController, 'handle']).as('admin.index');
    router.get('/hours', [LoginWindowController, 'show']);
    router.put('/hours', [LoginWindowController, 'update']);
    router.get('/rules', [AdminGameRulesController, 'show']);
    router.put('/rules', [AdminGameRulesController, 'update']);
    router.get('/devices', [DeviceController, 'index']);
    router.post('/devices/:device/approve', [DeviceController, 'approve']);
    router.patch('/devices/:device', [DeviceController, 'update']);
    router.delete('/devices/:device', [DeviceController, 'destroy']);
    router.get('/users', [UserController, 'index']);
    router.get('/users/create', [UserController, 'create']);
    router.post('/users', [UserController, 'store']);
    router.get('/users/:user/edit', [UserController, 'edit']);
    router.put('/users/:user', [UserController, 'update']);
    router.delete('/users/:user', [UserController, 'destroy']);
    router.delete('/users/:user/world', [UserController, 'resetWorld']);
    router.delete('/global-world', [AdminGlobalWorldController, 'handle']);
    router.get('/rooms', [AdminRoomController, 'index']);
    router.delete('/rooms/:code', [AdminRoomController, 'destroy']);
})
    .prefix('/admin')
    .use([middleware.auth({ guards: ['web'] }), middleware.access(), middleware.admin()]);
//# sourceMappingURL=routes.js.map