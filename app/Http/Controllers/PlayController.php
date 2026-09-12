<?php

namespace App\Http\Controllers;

use App\Models\Save;
use App\Models\Score;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** The one page: the game. Menu data (leaderboard, cloud save) arrives as props. */
class PlayController extends Controller
{
    public const CLOUD_SLOT = 'main';

    private const LEADERBOARD_SIZE = 8;

    public function __invoke(Request $request): Response
    {
        $user = $request->user();

        return Inertia::render('Play', [
            'leaderboard' => fn () => Score::query()
                ->selectRaw('user_id, MAX(score) as best')
                ->groupBy('user_id')
                ->orderByDesc('best')
                ->limit(self::LEADERBOARD_SIZE)
                ->with('user:id,name')
                ->get()
                ->map(fn (Score $row) => ['name' => $row->user?->name ?? 'Unknown', 'score' => (int) $row->best])
                ->values(),
            'cloudSave' => fn () => $user
                ? Save::query()->where('user_id', $user->id)->where('slot', self::CLOUD_SLOT)
                    ->first(['slot', 'size', 'night', 'seconds', 'updated_at'])
                : null,
        ]);
    }
}
