<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomSignal;
use App\Models\World;
use App\Services\GlobalWorld;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Room codes → host peer ids. Hosting does not require an account (guests can
 * host), but the room is tied to the account when one is logged in. The global
 * world's room may only be opened by the player at the front of its queue.
 */
class RoomController extends Controller
{
    private const CODE_RULE = 'regex:/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/';

    public const MAX_PLAYERS = 4;

    public function __construct(private readonly GlobalWorld $global) {}

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', self::CODE_RULE],
            'host_peer_id' => ['required', 'string', 'max:128'],
            'host_name' => ['required', 'string', 'max:16'],
            'world_kind' => ['sometimes', 'in:'.implode(',', World::KINDS)],
        ]);

        $existing = Room::query()->where('code', $data['code'])->first();
        if ($existing && $existing->expires_at->isFuture() && $existing->host_peer_id !== $data['host_peer_id']) {
            return response()->json(['message' => 'That room code is in use.'], 409);
        }
        $kind = $data['world_kind'] ?? World::OWN;
        if ($kind === World::GLOBAL && ! $this->global->isHost($request->user())) {
            return response()->json(['message' => 'Someone else is hosting the global world.'], 409);
        }

        // no scheduler on shared hosting: opening a room is when stale mail is swept
        RoomSignal::pruneStale();

        $room = Room::query()->updateOrCreate(
            ['code' => $data['code']],
            [
                'host_peer_id' => $data['host_peer_id'],
                'host_name' => $data['host_name'],
                'world_kind' => $kind,
                'user_id' => $request->user()?->id,
                'players' => 1,
                'expires_at' => now()->addHours(Room::TTL_HOURS),
            ],
        );
        if ($room->isGlobal()) {
            $this->global->roomOpened($request->user(), $room);
        }

        return response()->json(['room' => $room->toPublic()], 201);
    }

    /** resolve a code to the host's peer id: the host, or a player with an accepted invite (issue #5) */
    public function show(Request $request, string $code): JsonResponse
    {
        $room = Room::query()->live()->where('code', strtoupper($code))->first();
        if (! $room) {
            return response()->json(['message' => 'No game with that code.'], 404);
        }
        if (! $room->admits($request->user())) {
            return response()->json(['message' => 'You need an invitation to join this game.'], 403);
        }

        return response()->json(['room' => $room->toPublic()]);
    }

    /**
     * The host refreshes the TTL and player count while the match is running; in the
     * global world the accounts it lists as connected keep their seats fresh.
     */
    public function update(Request $request, string $code): JsonResponse
    {
        $data = $request->validate([
            'host_peer_id' => ['required', 'string', 'max:128'],
            'players' => ['required', 'integer', 'min:1', 'max:'.self::MAX_PLAYERS],
            'user_ids' => ['sometimes', 'array', 'max:'.self::MAX_PLAYERS],
            'user_ids.*' => ['integer'],
        ]);

        $room = Room::query()->where('code', strtoupper($code))->where('host_peer_id', $data['host_peer_id'])->first();
        if (! $room) {
            return response()->json(['message' => 'Not your room.'], 404);
        }
        if ($room->isGlobal()) {
            // a sign-in in another tab of the same browser swaps the session under the game tab
            if ($room->user_id !== null && $room->user_id !== $request->user()->id) {
                return response()->json(['message' => 'This browser is signed in as another player now — reload the page to carry on.'], 403);
            }
            if (! $this->global->heartbeat($request->user())) {
                return response()->json(['message' => 'The global world has moved to another host.'], 409);
            }
        }

        $room->update(['players' => $data['players'], 'expires_at' => now()->addHours(Room::TTL_HOURS)]);
        if ($room->isGlobal()) {
            $this->global->touch($request->user(), $data['user_ids'] ?? []);
        }

        return response()->json(['room' => $room->toPublic()]);
    }

    public function destroy(Request $request, string $code): JsonResponse
    {
        $data = $request->validate(['host_peer_id' => ['required', 'string', 'max:128']]);
        $room = Room::query()->where('code', strtoupper($code))->where('host_peer_id', $data['host_peer_id'])->first();
        if ($room) {
            RoomSignal::query()->where('room_code', $room->code)->delete();
            $room->delete();
            // closing the global world's room is its host leaving the world
            if ($room->isGlobal()) {
                $this->global->roomClosed($room);
            }
        }

        return response()->json(['ok' => true]);
    }
}
