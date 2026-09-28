<?php

namespace App\Http\Middleware;

use App\Models\GameHost;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The host PC's own sign-in: a bearer host token, looked up by its hash. It is separate
 * from player auth (no session, no Sanctum, no APP_KEY) and only opens the /api/host/*
 * routes. A revoked or disabled host gets a 401 and stops.
 */
class AuthenticateGameHost
{
    public const ATTRIBUTE = 'game_host';

    public function handle(Request $request, Closure $next): Response
    {
        $host = GameHost::findByToken($request->bearerToken());
        if (! $host || ! $host->enabled) {
            return response()->json(['message' => 'Unknown or revoked host token.'], 401);
        }
        $request->attributes->set(self::ATTRIBUTE, $host);

        return $next($request);
    }

    public static function host(Request $request): GameHost
    {
        return $request->attributes->get(self::ATTRIBUTE);
    }
}
