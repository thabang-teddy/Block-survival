<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\GameRules;
use Illuminate\Http\JsonResponse;

/** The native client reads the admin's game rules from here before it starts a match. */
class GameRulesController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json(['rules' => GameRules::fromSettings()->toArray()]);
    }
}
