<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\GameHost;
use App\Services\GlobalWorld;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * The PC that hosts the global world (docs/pc-host-research.md §5.1): create it (its
 * token is shown once), rotate or revoke the token, and release the world to the
 * browsers when the PC is paused and will not be back soon — the pause never ends by
 * itself.
 */
class PcHostController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        if (GameHost::current()) {
            return back()->with('status', 'There is a host PC already — rotate its token instead.');
        }
        $data = $request->validate(['name' => ['required', 'string', 'max:16']]);
        [, $token] = GameHost::register($data['name']);

        return back()->with('status', 'Host PC created. Copy its token now; it is not shown again.')->with('host_token', $token);
    }

    public function rotate(): RedirectResponse
    {
        $host = GameHost::current();
        if (! $host) {
            return back()->with('status', 'There is no host PC.');
        }

        return back()->with('status', 'New token issued; the old one stops working now.')->with('host_token', $host->rotateToken());
    }

    public function release(GlobalWorld $global): RedirectResponse
    {
        $global->releasePc();

        return back()->with('status', 'Released: browsers host the global world until the PC takes it back.');
    }

    /** revoke: the token stops working and the browsers host the world again */
    public function destroy(GlobalWorld $global): RedirectResponse
    {
        $global->releasePc();
        GameHost::current()?->delete();

        return back()->with('status', 'The host PC was removed; its token no longer works.');
    }
}
