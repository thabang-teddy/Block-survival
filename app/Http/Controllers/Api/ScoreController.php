<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Score;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScoreController extends Controller
{
    private const PER_NIGHT = 100;

    private const PER_KILL = 5;

    private const LEADERBOARD_SIZE = 20;

    /**
     * Record a run. The score is recomputed server-side from nights and kills so a
     * client cannot post an arbitrary number; the client's own value is ignored.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'nights' => ['required', 'integer', 'min:0', 'max:1000'],
            'kills' => ['required', 'integer', 'min:0', 'max:100000'],
            'deaths' => ['required', 'integer', 'min:0', 'max:100000'],
            'seconds' => ['required', 'integer', 'min:0', 'max:604800'],
        ]);

        $score = $request->user()->scores()->create([
            ...$data,
            'score' => $data['nights'] * self::PER_NIGHT + $data['kills'] * self::PER_KILL,
        ]);

        $best = $request->user()->scores()->max('score');

        return response()->json(['score' => $score->score, 'best' => (int) $best], 201);
    }

    /** Top runs, one row per player (their best). */
    public function leaderboard(): JsonResponse
    {
        $rows = Score::query()
            ->selectRaw('user_id, MAX(score) as best')
            ->groupBy('user_id')
            ->orderByDesc('best')
            ->limit(self::LEADERBOARD_SIZE)
            ->with('user:id,name')
            ->get()
            ->map(fn (Score $row) => [
                'name' => $row->user?->name ?? 'Unknown',
                'score' => (int) $row->best,
            ])
            ->values();

        return response()->json(['leaderboard' => $rows]);
    }
}
