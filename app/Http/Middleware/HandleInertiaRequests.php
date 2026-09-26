<?php

namespace App\Http\Middleware;

use App\Models\Device;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that is loaded on the first page visit.
     */
    protected $rootView = 'app';

    /**
     * Props shared with every Inertia page.
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $user = $request->user();

        return [
            ...parent::share($request),
            'auth' => [
                'user' => $user ? ['id' => $user->id, 'name' => $user->name, 'email' => $user->email, 'is_admin' => $user->isAdmin()] : null,
            ],
            'flash' => [
                'status' => fn () => $request->session()->get('status'),
                // a new host PC token, shown to the admin once
                'host_token' => fn () => $request->user()?->isAdmin() ? $request->session()->get('host_token') : null,
            ],
            // the admin nav badge; only computed inside the admin section
            'pendingDevices' => fn () => $request->is('admin*') && $user?->isAdmin() ? Device::query()->pending()->count() : 0,
        ];
    }
}
