<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomSignal;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/** Live rooms, with a force-close: what the host's own close does, minus the host_peer_id check. */
class RoomController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Admin/Rooms', [
            'rooms' => Room::query()->live()->withCount('invites')->latest()->get()
                ->map(fn (Room $r) => [
                    'code' => $r->code,
                    'host_name' => $r->host_name,
                    'world_kind' => $r->world_kind,
                    'players' => $r->players,
                    'invites' => (int) $r->invites_count,
                    'expires_at' => $r->expires_at->toIso8601String(),
                ])->all(),
        ]);
    }

    public function destroy(string $code): RedirectResponse
    {
        $code = strtoupper($code);
        if (Room::query()->where('code', $code)->delete()) {
            RoomSignal::query()->where('room_code', $code)->delete();
        }

        return back()->with('status', "Room {$code} closed.");
    }
}
