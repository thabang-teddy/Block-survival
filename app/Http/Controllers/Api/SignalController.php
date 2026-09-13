<?php

namespace App\Http\Controllers\Api;

use App\Events\RoomSignal;
use App\Http\Controllers\Controller;
use App\Models\Room;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * WebRTC signalling over Reverb: peers POST offers, answers and ICE candidates here
 * and the app broadcasts them on the room's channel. No third-party broker involved.
 */
class SignalController extends Controller
{
    private const PEER_ID = 'regex:/^[A-Za-z0-9_-]{8,64}$/';

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
        if (strlen(json_encode($data['data'])) > 16 * 1024) {
            return response()->json(['message' => 'Signal too large.'], 413);
        }

        broadcast(new RoomSignal($code, $data['from'], $data['to'], $data['type'], $data['data']))->toOthers();

        return response()->json(['ok' => true]);
    }
}
