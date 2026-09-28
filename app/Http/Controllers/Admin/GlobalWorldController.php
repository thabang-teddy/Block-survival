<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Controller;
use App\Models\GameHost;
use App\Services\GlobalWorld;
use Illuminate\Http\RedirectResponse;

/** Reset one global world: everyone's builds in it go; its PC starts a fresh map. */
class GlobalWorldController extends Controller
{
    public function __invoke(GlobalWorld $global, GameHost $host): RedirectResponse
    {
        try {
            $global->reset($host);
        } catch (GlobalWorldException $e) {
            return back()->with('status', $e->getMessage());
        }

        return back()->with('status', "{$host->name}'s world was reset.");
    }
}
