<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\GameHost;
use App\Services\GlobalWorld;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Host keys (docs/pc-host-research.md §8): one per global world, each run by a PC. Create
 * one (its token is shown once), rotate its token, enable or disable it, mark a paused
 * world offline when its PC will not be back soon, or remove it with its world.
 */
class PcHostController extends Controller
{
    public function __construct(private readonly GlobalWorld $global) {}

    public function index(): Response
    {
        $online = collect($this->global->worlds())->pluck('online', 'id');

        return Inertia::render('Admin/Hosts', [
            'hosts' => GameHost::query()->orderBy('id')->with('world')->get()
                ->map(fn (GameHost $h) => [
                    ...$h->toAdmin(),
                    'online' => (int) ($online[$h->id] ?? 0),
                    'save' => $h->world?->meta(),
                ])->all(),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:16'],
            'seed' => ['nullable', 'integer', 'min:1', 'max:'.GameHost::MAX_SEED],
        ]);
        [, $token] = GameHost::register($data['name'], $data['seed'] ?? null);

        return back()->with('status', "Host key \"{$data['name']}\" created. Copy its token now; it is not shown again.")->with('host_token', $token);
    }

    public function rotate(GameHost $host): RedirectResponse
    {
        return back()->with('status', "New token for {$host->name}; the old one stops working now.")->with('host_token', $host->rotateToken());
    }

    /** rename, or enable / disable: a disabled key's PC is refused and its world closes */
    public function update(Request $request, GameHost $host): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:16'],
            'enabled' => ['sometimes', 'boolean'],
        ]);
        if (($data['enabled'] ?? true) === false) {
            $this->global->markOffline($host);
        }
        $host->update($data);

        return back()->with('status', "{$host->name} updated.");
    }

    public function offline(GameHost $host): RedirectResponse
    {
        $this->global->markOffline($host);

        return back()->with('status', "{$host->name} is offline: its players went back to the lobby.");
    }

    /** revoke: the token stops working and the world's save goes with it */
    public function destroy(GameHost $host): RedirectResponse
    {
        $this->global->markOffline($host);
        $host->delete();

        return back()->with('status', "{$host->name} was removed with its world; its token no longer works.");
    }
}
