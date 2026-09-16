<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\GameRules;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Admin page for the day/night clock and the zombie schedule (see App\Support\GameRules). */
class GameRulesController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('Admin/Rules', [
            'rules' => GameRules::fromSettings()->values,
            'defaults' => GameRules::DEFAULTS,
            'bounds' => GameRules::BOUNDS,
        ]);
    }

    public function update(Request $request): RedirectResponse
    {
        GameRules::save($request->validate(GameRules::validationRules()));

        return back()->with('status', 'Game rules saved. They apply to matches started from now on.');
    }
}
