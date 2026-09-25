<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\IceServers;
use Illuminate\Http\JsonResponse;

/** The ICE servers a player's browser or app uses for its peer connection: STUN, plus TURN when configured. */
class IceServerController extends Controller
{
    public function __invoke(IceServers $ice): JsonResponse
    {
        return response()->json(['ice_servers' => $ice->get()]);
    }
}
