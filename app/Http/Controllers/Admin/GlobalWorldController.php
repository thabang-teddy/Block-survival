<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Controller;
use App\Services\GlobalWorld;
use Illuminate\Http\RedirectResponse;

/** Reset the shared global world: everyone's builds go; the next player to enter hosts a fresh map. */
class GlobalWorldController extends Controller
{
    public function __invoke(GlobalWorld $global): RedirectResponse
    {
        try {
            $global->reset();
        } catch (GlobalWorldException $e) {
            return back()->with('status', $e->getMessage());
        }

        return back()->with('status', 'The global world was reset.');
    }
}
