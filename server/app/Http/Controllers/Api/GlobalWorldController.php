<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Controller;
use App\Services\GlobalWorld;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Entering, staying in and leaving the shared global world. Every answer is a state
 * the player acts on: `host` (open a room), `client` (connect to the room given) or
 * `pending` (the chosen host is still opening theirs — ask again shortly).
 */
class GlobalWorldController extends Controller
{
    public function __construct(private readonly GlobalWorld $world) {}

    /** who is in the shared world right now — the lobby card (the web page gets this as an Inertia prop) */
    public function presence(): JsonResponse
    {
        return response()->json($this->world->presence());
    }

    public function join(Request $request): JsonResponse
    {
        return $this->answer(fn () => $this->world->join($request->user()));
    }

    public function claim(Request $request): JsonResponse
    {
        return $this->answer(fn () => $this->world->claim($request->user()));
    }

    public function leave(Request $request): JsonResponse
    {
        $this->world->leave($request->user());

        return response()->json(['ok' => true]);
    }

    /** @param  callable(): array<string, mixed>  $act */
    private function answer(callable $act): JsonResponse
    {
        try {
            return response()->json($act());
        } catch (GlobalWorldException $e) {
            return response()->json(['message' => $e->getMessage()], $e->getCode());
        }
    }
}
