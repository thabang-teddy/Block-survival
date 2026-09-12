<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Save;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Cloud saves: the host uploads its world as gzipped JSON (block diff, props,
 * clock, inventories) in the request body; GET streams the same bytes back.
 */
class SaveController extends Controller
{
    private const SLOT_PATTERN = '/^[a-z0-9_-]{1,32}$/';

    public function index(Request $request): JsonResponse
    {
        $saves = $request->user()->saves()
            ->orderByDesc('updated_at')
            ->get(['slot', 'size', 'night', 'seconds', 'updated_at']);

        return response()->json(['saves' => $saves]);
    }

    public function update(Request $request, string $slot): JsonResponse
    {
        if (! preg_match(self::SLOT_PATTERN, $slot)) {
            return response()->json(['message' => 'Bad slot name.'], 422);
        }
        $bytes = $request->getContent();
        if ($bytes === '' || strlen($bytes) > Save::MAX_BYTES) {
            return response()->json(['message' => 'Save must be between 1 byte and 2 MB.'], 413);
        }
        if (! str_starts_with($bytes, "\x1f\x8b")) {
            return response()->json(['message' => 'Save must be gzip-compressed JSON.'], 422);
        }
        $meta = $request->validate([
            'night' => ['sometimes', 'integer', 'min:0'],
            'seconds' => ['sometimes', 'integer', 'min:0'],
        ]);

        $save = $request->user()->saves()->updateOrCreate(
            ['slot' => $slot],
            [
                'payload' => base64_encode($bytes),
                'size' => strlen($bytes),
                'night' => (int) $request->query('night', $meta['night'] ?? 0),
                'seconds' => (int) $request->query('seconds', $meta['seconds'] ?? 0),
            ],
        );

        return response()->json(['save' => $save->only(['slot', 'size', 'night', 'seconds', 'updated_at'])]);
    }

    public function show(Request $request, string $slot): Response|JsonResponse
    {
        $save = $request->user()->saves()->where('slot', $slot)->first();
        if (! $save) {
            return response()->json(['message' => 'No save in that slot.'], 404);
        }

        return response(base64_decode($save->payload), 200, [
            'Content-Type' => 'application/gzip',
            'Content-Length' => (string) $save->size,
            'X-Save-Night' => (string) $save->night,
            'X-Save-Seconds' => (string) $save->seconds,
        ]);
    }

    public function destroy(Request $request, string $slot): JsonResponse
    {
        $request->user()->saves()->where('slot', $slot)->delete();

        return response()->json(['ok' => true]);
    }
}
