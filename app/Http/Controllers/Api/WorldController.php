<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\World;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The player's one world. The host uploads it as gzipped JSON (block diff,
 * clock, inventory) in the request body; GET streams the same bytes back.
 */
class WorldController extends Controller
{
    public function update(Request $request): JsonResponse
    {
        $bytes = $request->getContent();
        if ($bytes === '' || strlen($bytes) > World::MAX_BYTES) {
            return response()->json(['message' => 'Save must be between 1 byte and 2 MB.'], 413);
        }
        if (! str_starts_with($bytes, "\x1f\x8b")) {
            return response()->json(['message' => 'Save must be gzip-compressed JSON.'], 422);
        }
        $meta = $request->validate([
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);

        $world = World::query()->updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'payload' => base64_encode($bytes),
                'size' => strlen($bytes),
                'night' => (int) ($meta['night'] ?? 0),
                'seconds' => (int) ($meta['seconds'] ?? 0),
            ],
        );

        return response()->json(['world' => $world->meta()]);
    }

    public function show(Request $request): Response|JsonResponse
    {
        $world = $request->user()->world()->first();
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

    /** start over: the next save creates a fresh world */
    public function destroy(Request $request): JsonResponse
    {
        $request->user()->world()->delete();

        return response()->json(['ok' => true]);
    }
}
