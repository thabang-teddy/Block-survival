<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomSignal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Room codes → host peer ids. Hosting does not require an account (guests can
 * host), but the room is tied to the account when one is logged in.
 */
class RoomController extends Controller
{
    private const CODE_RULE = 'regex:/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/';

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', self::CODE_RULE],
            'host_peer_id' => ['required', 'string', 'max:128'],
            'host_name' => ['required', 'string', 'max:16'],
        ]);

        $existing = Room::query()->where('code', $data['code'])->first();
        if ($existing && $existing->expires_at->isFuture() && $existing->host_peer_id !== $data['host_peer_id']) {
            return response()->json(['message' => 'That room code is in use.'], 409);
        }

        // no scheduler on shared hosting: opening a room is when stale mail is swept
        RoomSignal::pruneStale();

        $room = Room::query()->updateOrCreate(
            ['code' => $data['code']],
            [
                'host_peer_id' => $data['host_peer_id'],
                'host_name' => $data['host_name'],
                'user_id' => $request->user()?->id,
                'players' => 1,
                'expires_at' => now()->addHours(Room::TTL_HOURS),
            ],
        );

        return response()->json(['room' => $this->publicRoom($room)], 201);
    }

    public function show(string $code): JsonResponse
    {
        $room = Room::query()->live()->where('code', strtoupper($code))->first();
        if (! $room) {
            return response()->json(['message' => 'No game with that code.'], 404);
        }

        return response()->json(['room' => $this->publicRoom($room)]);
    }

    /** The host refreshes the TTL and player count while the match is running. */
    public function update(Request $request, string $code): JsonResponse
    {
        $data = $request->validate([
            'host_peer_id' => ['required', 'string', 'max:128'],
            'players' => ['required', 'integer', 'min:1', 'max:4'],
        ]);

        $room = Room::query()->where('code', strtoupper($code))->where('host_peer_id', $data['host_peer_id'])->first();
        if (! $room) {
            return response()->json(['message' => 'Not your room.'], 404);
        }

        $room->update(['players' => $data['players'], 'expires_at' => now()->addHours(Room::TTL_HOURS)]);

        return response()->json(['room' => $this->publicRoom($room)]);
    }

    public function destroy(Request $request, string $code): JsonResponse
    {
        $data = $request->validate(['host_peer_id' => ['required', 'string', 'max:128']]);
        $deleted = Room::query()->where('code', strtoupper($code))->where('host_peer_id', $data['host_peer_id'])->delete();
        if ($deleted) {
            RoomSignal::query()->where('room_code', strtoupper($code))->delete();
        }

        return response()->json(['ok' => true]);
    }

    /** @return array<string, mixed> */
    private function publicRoom(Room $room): array
    {
        return [
            'code' => $room->code,
            'host_peer_id' => $room->host_peer_id,
            'host_name' => $room->host_name,
            'players' => $room->players,
            'expires_at' => $room->expires_at->toIso8601String(),
        ];
    }
}
