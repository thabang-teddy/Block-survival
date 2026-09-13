<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomSignal;
use Illuminate\Http\RedirectResponse;

/** Force-close a room: what the host's own close does, minus the host_peer_id check. */
class RoomController extends Controller
{
    public function destroy(string $code): RedirectResponse
    {
        $code = strtoupper($code);
        if (Room::query()->where('code', $code)->delete()) {
            RoomSignal::query()->where('room_code', $code)->delete();
        }

        return back()->with('status', "Room {$code} closed.");
    }
}
