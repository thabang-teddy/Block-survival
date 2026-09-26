<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomInvite;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Invitations (issue #5): the only way into someone else's world. The host picks
 * players by name from the pause screen; the invitee sees the invite in the lobby
 * and accepts it, which is the one place a non-host learns the host's peer id.
 */
class InviteController extends Controller
{
    /** every other enabled player, for the host's invite list */
    public function players(Request $request): JsonResponse
    {
        $players = User::query()
            ->where('id', '!=', $request->user()->id)
            ->where('is_disabled', false)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name]);

        return response()->json(['players' => $players]);
    }

    /** the host invites one player into their room (re-inviting after a decline is fine) */
    public function store(Request $request, string $code): JsonResponse
    {
        $room = Room::query()->live()->where('code', strtoupper($code))->first();
        if (! $room) {
            return response()->json(['message' => 'No game with that code.'], 404);
        }
        if (! $room->isHostedBy($request->user())) {
            return response()->json(['message' => 'Only the host can invite players.'], 403);
        }
        $data = $request->validate(['user_id' => ['required', 'integer', 'exists:users,id']]);
        if ((int) $data['user_id'] === $request->user()->id) {
            return response()->json(['message' => 'You are already in your own game.'], 422);
        }

        $invite = RoomInvite::query()->firstOrNew(['room_id' => $room->id, 'to_user_id' => (int) $data['user_id']]);
        $fresh = ! $invite->exists;
        if ($fresh || $invite->status === RoomInvite::DECLINED) {
            $invite->from_user_id = $request->user()->id;
            $invite->status = RoomInvite::PENDING;
            $invite->save();
        }

        return response()->json(['invite' => $this->hostView($invite->load('to'))], $fresh ? 201 : 200);
    }

    /** the host's view of who has been invited into a room and where they stand */
    public function room(Request $request, string $code): JsonResponse
    {
        $room = Room::query()->live()->where('code', strtoupper($code))->first();
        if (! $room) {
            return response()->json(['message' => 'No game with that code.'], 404);
        }
        if (! $room->isHostedBy($request->user())) {
            return response()->json(['message' => 'Not your room.'], 403);
        }

        return response()->json([
            'invites' => $room->invites()->with('to')->orderBy('id')->get()->map(fn (RoomInvite $i) => $this->hostView($i)),
        ]);
    }

    /**
     * My invites into rooms whose host is hosting right now and that have a seat: pending
     * ones, and accepted ones (I left and may go back in for as long as the host hosts).
     */
    public function index(Request $request): JsonResponse
    {
        $invites = RoomInvite::query()->whereIn('status', [RoomInvite::PENDING, RoomInvite::ACCEPTED])
            ->where('to_user_id', $request->user()->id)
            ->whereHas('room', fn ($q) => $q->hosting()->where('players', '<', RoomController::MAX_PLAYERS))
            ->with('room')
            ->latest('id')
            ->get()
            ->map(fn (RoomInvite $i) => $i->toPublic());

        return response()->json(['invites' => $invites]);
    }

    /** accept: the invite is mine and pending; the answer carries the host's peer id */
    public function accept(Request $request, RoomInvite $invite): JsonResponse
    {
        if ($invite->to_user_id !== $request->user()->id) {
            return response()->json(['message' => 'Not your invite.'], 403);
        }
        $room = $invite->room;
        if (! $room || ! $room->isHosting()) {
            return response()->json(['message' => 'That game is over.'], 410);
        }
        if ($invite->status === RoomInvite::DECLINED) {
            return response()->json(['message' => 'You declined this invite.'], 409);
        }
        $invite->update(['status' => RoomInvite::ACCEPTED]);

        return response()->json([
            'invite' => $invite->toPublic(),
            'room' => [
                'code' => $room->code,
                'host_peer_id' => $room->host_peer_id,
                'host_name' => $room->host_name,
                'world_kind' => $room->world_kind,
                'players' => $room->players,
                'expires_at' => $room->expires_at->toIso8601String(),
            ],
        ]);
    }

    public function decline(Request $request, RoomInvite $invite): JsonResponse
    {
        if ($invite->to_user_id !== $request->user()->id) {
            return response()->json(['message' => 'Not your invite.'], 403);
        }
        $invite->update(['status' => RoomInvite::DECLINED]);

        return response()->json(['ok' => true]);
    }

    /** @return array<string, mixed> */
    private function hostView(RoomInvite $invite): array
    {
        return [
            'id' => $invite->id,
            'user_id' => $invite->to_user_id,
            'name' => $invite->to?->name ?? 'Unknown',
            'status' => $invite->status,
        ];
    }
}
