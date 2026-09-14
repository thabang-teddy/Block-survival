<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomSignal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * WebRTC signalling over plain HTTP: peers POST offers, answers and ICE
 * candidates into the room's mailbox and poll for the ones addressed to them.
 * No socket server, no third-party broker — it runs anywhere PHP does.
 */
class SignalController extends Controller
{
    private const PEER_ID = 'regex:/^[A-Za-z0-9_-]{8,64}$/';

    private const MAX_BYTES = 16 * 1024;

    public function store(Request $request, string $code): JsonResponse
    {
        $code = strtoupper($code);
        if (! Room::query()->live()->where('code', $code)->exists()) {
            return response()->json(['message' => 'No game with that code.'], 404);
        }

        $data = $request->validate([
            'from' => ['required', 'string', self::PEER_ID],
            'to' => ['required', 'string', self::PEER_ID],
            'type' => ['required', 'in:offer,answer,candidate'],
            // an SDP or an RTCIceCandidateInit; kept opaque, size-limited
            'data' => ['required', 'array'],
        ]);
        if (strlen(json_encode($data['data'])) > self::MAX_BYTES) {
            return response()->json(['message' => 'Signal too large.'], 413);
        }

        $signal = RoomSignal::create([
            'room_code' => $code,
            'from_peer' => $data['from'],
            'to_peer' => $data['to'],
            'type' => $data['type'],
            'data' => $data['data'],
        ]);

        return response()->json(['id' => $signal->id], 201);
    }

    /** Everything addressed to `to` with an id past `after`, oldest first. */
    public function index(Request $request, string $code): JsonResponse
    {
        $code = strtoupper($code);
        if (! Room::query()->live()->where('code', $code)->exists()) {
            return response()->json(['message' => 'No game with that code.'], 404);
        }

        $q = $request->validate([
            'to' => ['required', 'string', self::PEER_ID],
            'after' => ['sometimes', 'integer', 'min:0'],
        ]);

        $signals = RoomSignal::query()
            ->addressedTo($code, $q['to'], (int) ($q['after'] ?? 0))
            ->limit(RoomSignal::PAGE)
            ->get()
            ->map(fn (RoomSignal $s) => $s->toPublic());

        return response()->json(['signals' => $signals]);
    }
}
