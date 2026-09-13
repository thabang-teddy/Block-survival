<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * Approve or forget browsers. Rejecting a pending device and revoking an approved
 * one are the same thing: the row goes, and the next sign-in from that browser
 * creates a fresh pending device.
 */
class DeviceController extends Controller
{
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
}
