<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\Room;
use App\Models\User;
use App\Support\LoginWindow;
use DateTimeZone;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** The admin section: one page with the login window, devices, users and live rooms. */
class DashboardController extends Controller
{
    public function __invoke(Request $request): Response
    {
        // no scheduler on shared hosting: opening the admin page is when stale devices are swept
        Device::pruneStale();

        return Inertia::render('Admin', [
            'loginWindow' => LoginWindow::fromSettings()->toArray(),
            'timezones' => DateTimeZone::listIdentifiers(),
            'devices' => fn () => $this->devices(),
            'users' => fn () => $this->users(),
            'rooms' => fn () => $this->rooms(),
        ]);
    }

    /** @return array<int, array<string, mixed>> pending first, then most recently seen */
    private function devices(): array
    {
        return Device::query()->with('user:id,name,email')
            ->orderByRaw('approved_at IS NULL DESC')->orderByDesc('last_seen_at')->get()
            ->map(fn (Device $d) => [
                'id' => $d->id,
                'label' => $d->label,
                'user' => $d->user ? ['id' => $d->user->id, 'name' => $d->user->name, 'email' => $d->user->email] : null,
                'user_agent' => $d->user_agent,
                'ip' => $d->ip,
                'first_seen_at' => $d->created_at?->toIso8601String(),
                'last_seen_at' => $d->last_seen_at?->toIso8601String(),
                'approved_at' => $d->approved_at?->toIso8601String(),
            ])->all();
    }

    /** @return array<int, array<string, mixed>> */
    private function users(): array
    {
        return User::query()->withCount('devices')->orderBy('name')->get()
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'is_admin' => $u->isAdmin(),
                'is_env_admin' => $u->isEnvAdmin(),
                'is_disabled' => $u->is_disabled,
                'devices_count' => $u->devices_count,
                'last_login_at' => $u->last_login_at?->toIso8601String(),
                'created_at' => $u->created_at?->toIso8601String(),
            ])->all();
    }

    /** @return array<int, array<string, mixed>> */
    private function rooms(): array
    {
        return Room::query()->live()->latest()->get()
            ->map(fn (Room $r) => [
                'code' => $r->code,
                'host_name' => $r->host_name,
                'players' => $r->players,
                'expires_at' => $r->expires_at->toIso8601String(),
            ])->all();
    }
}
