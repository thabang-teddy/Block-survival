<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Takes the site down when APP_MAINTENANCE_MODE=true in .env, without needing
 * `php artisan down` (which cPanel deploys use separately). The /up health
 * endpoint stays reachable so uptime probes can tell "maintenance" from "dead".
 */
class EnforceMaintenanceToggle
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('app.maintenance.enabled') && ! $request->is('up')) {
            abort(503, 'Down for maintenance');
        }

        return $next($request);
    }
}
