<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Approve or forget browsers. Rejecting a pending device and revoking an approved
 * one are the same thing: the row goes, and the next sign-in from that browser
 * creates a fresh pending device.
 */
class DeviceController extends Controller
{
    public function index(): Response
    {
        Device::pruneStale();

        return Inertia::render('Admin/Devices', ['devices' => $this->devices()]);
    }

    public function approve(Request $request, Device $device): RedirectResponse
    {
        $device->update(['approved_at' => now(), 'approved_by' => $request->user()->id]);

        return back()->with('status', "Device #{$device->id} approved.");
    }

    public function update(Request $request, Device $device): RedirectResponse
    {
        $data = $request->validate(['label' => ['nullable', 'string', 'max:40']]);
        $device->update(['label' => $data['label'] ?: null]);

        return back();
    }

    public function destroy(Device $device): RedirectResponse
    {
        $device->delete();

        return back()->with('status', "Device #{$device->id} removed.");
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
}
