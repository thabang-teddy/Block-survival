<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\Room;
use App\Models\User;
use App\Support\LoginWindow;
use Inertia\Inertia;
use Inertia\Response;

/** The admin front page: counts, and where to go next. */
class DashboardController extends Controller
{
    public function __invoke(): Response
    {
        // no scheduler on shared hosting: opening the admin section is when stale devices are swept
        Device::pruneStale();
        $window = LoginWindow::fromSettings();

        return Inertia::render('Admin/Dashboard', [
            'counts' => [
                'pendingDevices' => Device::query()->pending()->count(),
                'approvedDevices' => Device::query()->approved()->count(),
                'users' => User::query()->count(),
                'disabledUsers' => User::query()->where('is_disabled', true)->count(),
                'rooms' => Room::query()->live()->count(),
            ],
            'loginWindow' => $window->toArray(),
            'windowOpen' => $window->isOpen(now()),
        ]);
    }
}
