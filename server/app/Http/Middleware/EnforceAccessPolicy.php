<?php

namespace App\Http\Middleware;

use App\Support\AccessPolicy;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ends a signed-in session the moment it is no longer allowed: the account was
 * disabled, the login window closed, or an admin revoked this browser. Runs on
 * every authenticated route (pages and /api); admins are exempt.
 */
class EnforceAccessPolicy
{
    public function __construct(private readonly AccessPolicy $policy) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user) {
            return $next($request);
        }

        if ($reason = $this->policy->blockedReason($user)) {
            return $this->endSession($request, $reason, '/login');
        }
        if (! $this->policy->deviceAllowed($user, $this->policy->knownDevice($request))) {
            return $this->endSession($request, 'This PC is waiting for admin approval.', '/pending-approval');
        }

        return $next($request);
    }

    private function endSession(Request $request, string $reason, string $to): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        if ($request->is('api/*') || $request->expectsJson()) {
            return response()->json(['message' => $reason], 403);
        }

        return redirect($to)->with('status', $reason);
    }
}
