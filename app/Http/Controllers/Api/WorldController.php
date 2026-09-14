<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\World;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The player's one world. The host uploads it as gzipped JSON (block diff, clock,
 * every player's gear, live zombies / drops / crates) in the request body; GET streams
 * the same bytes back. A page that is closing cannot await a PUT, so it posts the same
 * bytes as a multipart beacon instead (issue #13).
 */
class WorldController extends Controller
{
    public function update(Request $request): JsonResponse
    {
        $meta = $request->validate([
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);

        return $this->store($request, $request->getContent(), $meta);
    }

    /** `navigator.sendBeacon` on unload: multipart with the gzip as a file and the CSRF token as a field */
    public function beacon(Request $request): JsonResponse
    {
        $meta = $request->validate([
            'payload' => ['required', 'file'],
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);
        $bytes = (string) file_get_contents($request->file('payload')->getRealPath());

        return $this->store($request, $bytes, $meta);
    }

    private function store(Request $request, string $bytes, array $meta): JsonResponse
    {
        if ($bytes === '' || strlen($bytes) > World::MAX_BYTES) {
            return response()->json(['message' => 'Save must be between 1 byte and '.(World::MAX_BYTES / 1024 / 1024).' MB.'], 413);
        }
        if (! str_starts_with($bytes, "\x1f\x8b")) {
            return response()->json(['message' => 'Save must be gzip-compressed JSON.'], 422);
        }

        $world = World::query()->updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'payload' => base64_encode($bytes),
                'size' => strlen($bytes),
                'night' => (int) ($meta['night'] ?? 0),
                'seconds' => (int) ($meta['seconds'] ?? 0),
                'players' => self::playerCount($bytes),
            ],
        );

        return response()->json(['world' => $world->meta()]);
    }

    /** how many accounts the save holds gear for; older formats held only the host */
    private static function playerCount(string $gzip): int
    {
        $json = @gzdecode($gzip);
        if ($json === false) {
            return 1;
        }
        $data = json_decode($json, true);
        if (! is_array($data) || ! isset($data['players']) || ! is_array($data['players'])) {
            return 1;
        }

        return max(1, min(65535, count($data['players'])));
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
