<?php

namespace App\Http\Controllers;

use App\Models\Score;
use App\Services\GlobalWorld;
use App\Support\GameRules;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** The one page: the game. Menu data (leaderboard, the player's worlds) arrives as props. */
class PlayController extends Controller
{
    private const LEADERBOARD_SIZE = 8;

    public function __invoke(Request $request, GlobalWorld $global): Response
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
            'worlds' => fn () => $user?->worldsMeta() ?? ['own' => null, 'global' => null],
            // who is in the shared global world right now
            'presence' => fn () => $global->presence(),
            // the admin's day/night clock and zombie schedule
            'rules' => GameRules::fromSettings()->toArray(),
        ]);
    }
}
