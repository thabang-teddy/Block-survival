<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\AuthenticateGameHost;
use App\Models\Device;
use App\Models\GameHost;
use App\Models\RoomSignal;
use App\Models\Score;
use App\Models\User;
use App\Models\World;
use App\Services\GlobalWorld;
use App\Support\AccessPolicy;
use App\Support\IceServers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The host PC's side of the site (docs/pc-host-research.md §5.1): its heartbeat, the
 * global room's mailbox, the global save, scores and the access re-checks. Every route
 * is behind the host token (AuthenticateGameHost); none of them reaches a player's
 * account or session.
 */
class HostController extends Controller
{
    private const CODE_RULE = 'regex:/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/';

    /** a heartbeat's stats blob is diagnostics, not storage */
    private const MAX_STATS_BYTES = 4096;

    public function __construct(private readonly GlobalWorld $global) {}

    public function heartbeat(Request $request): JsonResponse
    {
        $data = $request->validate([
            'version' => ['required', 'string', 'max:32'],
            'peer_id' => ['required', 'string', SignalController::PEER_ID],
            'going' => ['sometimes', 'in:offline,restart'],
            'room' => ['required_without:going', 'array'],
            'room.code' => ['required_with:room', 'string', self::CODE_RULE],
            'room.players' => ['required_with:room', 'integer', 'min:0', 'max:'.RoomController::MAX_PLAYERS],
            'room.user_ids' => ['sometimes', 'array', 'max:'.RoomController::MAX_PLAYERS],
            'room.user_ids.*' => ['integer'],
            'stats' => ['sometimes', 'array'],
        ]);
        if (isset($data['stats']) && strlen((string) json_encode($data['stats'])) > self::MAX_STATS_BYTES) {
            return response()->json(['message' => 'Stats too large.'], 413);
        }
        try {
            return response()->json($this->global->pcHeartbeat(AuthenticateGameHost::host($request), $data));
        } catch (GlobalWorldException $e) {
            return response()->json(['message' => $e->getMessage()], $e->getCode());
        }
    }

    /** the global room's mail for the PC, each row with who the site says posted it */
    public function signals(Request $request): JsonResponse
    {
        $q = $request->validate(['after' => ['sometimes', 'integer', 'min:0']]);
        $pc = $this->online($request);
        if (! $pc) {
            return response()->json(['signals' => []]);
        }
        $signals = RoomSignal::query()
            ->addressedTo($pc->room_code, $pc->peer_id, (int) ($q['after'] ?? 0))
            ->with('sender:id,name')
            ->limit(RoomSignal::PAGE)
            ->get()
            ->map(fn (RoomSignal $s) => $s->toHost());

        return response()->json(['signals' => $signals]);
    }

    /** the PC answers an offer or trickles a candidate to one player */
    public function signal(Request $request): JsonResponse
    {
        $data = $request->validate([
            'to' => ['required', 'string', SignalController::PEER_ID],
            'type' => ['required', 'in:answer,candidate'],
            'data' => ['required', 'array'],
        ]);
        if (strlen((string) json_encode($data['data'])) > SignalController::MAX_BYTES) {
            return response()->json(['message' => 'Signal too large.'], 413);
        }
        $pc = $this->online($request);
        if (! $pc) {
            return response()->json(['message' => 'The PC does not hold the global world right now.'], 409);
        }
        $signal = RoomSignal::create([
            'room_code' => $pc->room_code,
            'from_peer' => $pc->peer_id,
            'to_peer' => $data['to'],
            'type' => $data['type'],
            'data' => $data['data'],
        ]);

        return response()->json(['id' => $signal->id], 201);
    }

    public function showWorld(): Response|JsonResponse
    {
        $world = World::global();
        if (! $world) {
            return response()->json(['message' => 'No world yet.'], 404);
        }

        return response(base64_decode($world->payload), 200, [
            'Content-Type' => 'application/gzip',
            'Content-Length' => (string) $world->size,
            'X-Save-Night' => (string) $world->night,
            'X-Save-Seconds' => (string) $world->seconds,
        ]);
    }

    public function storeWorld(Request $request): JsonResponse
    {
        $meta = $request->validate([
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);
        $bytes = $request->getContent();
        if ($problem = World::uploadProblem($bytes)) {
            return response()->json(['message' => $problem[0]], $problem[1]);
        }
        if (! AuthenticateGameHost::host($request)->holdsWorld()) {
            return response()->json(['message' => 'The global world is hosted by the browsers right now.'], 409);
        }

        return response()->json(['world' => World::put(null, World::GLOBAL, $bytes, $meta)->meta()]);
    }

    /** runs the PC's sim recorded (at dawn and on death), scored like a player's own */
    public function scores(Request $request): JsonResponse
    {
        $rules = ['runs' => ['required', 'array', 'max:20'], 'runs.*.user_id' => ['required', 'integer']];
        foreach (Score::RUN_RULES as $key => $rule) {
            $rules["runs.*.$key"] = $rule;
        }
        $data = $request->validate($rules);
        $users = User::query()->whereIn('id', array_column($data['runs'], 'user_id'))->get()->keyBy('id');
        $recorded = 0;
        foreach ($data['runs'] as $run) {
            $user = $users->get($run['user_id']);
            if ($user) {
                Score::record($user, $run);
                $recorded++;
            }
        }

        return response()->json(['recorded' => $recorded], 201);
    }

    /**
     * The PC re-checks everyone connected every 30 s: a disabled account, a closed login
     * window or a revoked device ends that player's session.
     */
    public function access(Request $request, AccessPolicy $policy): JsonResponse
    {
        $data = $request->validate([
            'players' => ['required', 'array', 'max:'.RoomController::MAX_PLAYERS * 2],
            'players.*.user_id' => ['required', 'integer'],
            'players.*.device_id' => ['present', 'nullable', 'integer'],
        ]);
        $results = [];
        foreach ($data['players'] as $p) {
            $user = User::find($p['user_id']);
            $device = $p['device_id'] !== null ? Device::find($p['device_id']) : null;
            $reason = match (true) {
                $user === null => 'This account no longer exists.',
                default => $policy->blockedReason($user)
                    ?? ($policy->deviceAllowed($user, $device) ? null : 'This PC is waiting for admin approval.'),
            };
            $results[] = ['user_id' => $p['user_id'], 'device_id' => $p['device_id'], 'reason' => $reason];
        }

        return response()->json(['results' => $results]);
    }

    public function iceServers(IceServers $ice): JsonResponse
    {
        return response()->json(['ice_servers' => $ice->get()]);
    }

    /** the PC, while it is online and has its room */
    private function online(Request $request): ?GameHost
    {
        $pc = AuthenticateGameHost::host($request);

        return $pc->state() === GameHost::ONLINE && $pc->room_code !== null ? $pc : null;
    }
}
