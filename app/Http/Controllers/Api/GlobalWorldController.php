<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Controller;
use App\Models\GameHost;
use App\Services\GlobalWorld;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The global worlds: the list the lobby shows, and entering, staying in and leaving one.
 * Every answer is a state the player acts on: `client` (connect to the PC's room),
 * `paused` (the PC went quiet — ask again shortly) or `offline` (back to the lobby).
 */
class GlobalWorldController extends Controller
{
    public function __construct(private readonly GlobalWorld $world) {}

    /** every world and who is in it — the lobby list (the web page gets this as an Inertia prop) */
    public function index(): JsonResponse
    {
        return response()->json(['worlds' => $this->world->worlds()]);
    }

    /** clients from before there were many worlds: the lobby card of the world they would enter */
    public function presence(): JsonResponse
    {
        $pc = $this->world->defaultWorld();

        return response()->json([
            'online' => $pc ? $this->world->online($pc) : 0,
            'host_name' => $pc?->name,
            'paused' => $pc?->state() === GameHost::PAUSED,
        ]);
    }

    /** `world` picks one; clients from before there were many worlds leave it out and get the first open one */
    public function join(Request $request): JsonResponse
    {
        $data = $request->validate(['world' => ['sometimes', 'integer', 'min:1']]);
        $pc = isset($data['world']) ? $this->world->find($data['world']) : $this->world->defaultWorld();
        if (! $pc) {
            return response()->json(['message' => 'There is no such world.'], 404);
        }

        return $this->answer(fn () => $this->world->join($request->user(), $pc));
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
