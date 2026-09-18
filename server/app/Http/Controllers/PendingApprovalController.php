<?php

namespace App\Http\Controllers;

use App\Support\AccessPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Where a signed-in-but-unapproved browser waits. The page polls `status` and
 * sends the player back to /login once an admin has approved the device.
 */
class PendingApprovalController extends Controller
{
    public function __construct(private readonly AccessPolicy $policy) {}

    public function show(Request $request): Response|RedirectResponse
    {
        $device = $this->policy->knownDevice($request);
        if (! $device) {
            return redirect('/login');
        }

        return Inertia::render('PendingApproval', [
            'device' => ['id' => $device->id, 'approved' => $device->isApproved()],
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        $device = $this->policy->knownDevice($request);

        return response()->json(['known' => $device !== null, 'approved' => $device?->isApproved() ?? false]);
    }
}
