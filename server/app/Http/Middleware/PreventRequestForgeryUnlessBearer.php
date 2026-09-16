<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Auth;

/**
 * The native client talks to /api with a Sanctum bearer token and no session, so
 * it has no CSRF token to send. CSRF protects cookie-carried sessions: a request
 * that carries a bearer token and no signed-in session cannot be forged by another
 * origin (a browser will not attach a custom Authorization header cross-origin
 * without a CORS preflight, which the API does not grant). Anything with a session
 * behind it — the browser client — is still checked.
 */
class PreventRequestForgeryUnlessBearer extends PreventRequestForgery
{
    /**
     * Sign-in and the approval poll have no token yet. Neither opens a session,
     * and each answers with data only the caller can read, so a forged POST
     * gains an attacker nothing.
     *
     * @var array<int, string>
     */
    protected $except = ['api/auth/token', 'api/auth/status'];

    protected function inExceptArray($request): bool
    {
        if ($request->is('api/*') && $request->bearerToken() && ! $this->hasSessionLogin($request)) {
            return true;
        }

        return parent::inExceptArray($request);
    }

    private function hasSessionLogin($request): bool
    {
        return $request->hasSession() && $request->session()->has(Auth::guard('web')->getName());
    }
}
