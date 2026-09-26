<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\World;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The player's own world (`own`). Global worlds are saved by their host PCs through the
 * host API, never by a browser. The host uploads a world as gzipped
 * JSON (block diff, clock, every player's gear, live zombies / drops / crates) in the
 * request body; GET streams the same bytes back. A page that is closing cannot await a
 * PUT, so it posts the same bytes as a multipart beacon instead (issue #13).
 */
class WorldController extends Controller
{
    public function update(Request $request, string $kind = World::OWN): JsonResponse
    {
        $meta = $request->validate([
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);

        return $this->store($request, $kind, $request->getContent(), $meta);
    }

    /** `navigator.sendBeacon` on unload: multipart with the gzip as a file and the CSRF token as a field */
    public function beacon(Request $request, string $kind = World::OWN): JsonResponse
    {
        $meta = $request->validate([
            'payload' => ['required', 'file'],
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);
        $bytes = (string) file_get_contents($request->file('payload')->getRealPath());

        return $this->store($request, $kind, $bytes, $meta);
    }

    private function store(Request $request, string $kind, string $bytes, array $meta): JsonResponse
    {
        abort_unless($kind === World::OWN, 404);
        if ($problem = World::uploadProblem($bytes)) {
            return response()->json(['message' => $problem[0]], $problem[1]);
        }
        $world = World::put($request->user()->id, $kind, $bytes, $meta);

        return response()->json(['world' => $world->meta()]);
    }

    public function show(Request $request, string $kind = World::OWN): Response|JsonResponse
    {
        abort_unless($kind === World::OWN, 404);
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

    /** start over in the player's own world: the next save creates a fresh one (an admin resets the global worlds) */
    public function destroy(Request $request): JsonResponse
    {
        $request->user()->worlds()->where('kind', World::OWN)->delete();

        return response()->json(['ok' => true]);
    }
}
