<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The ICE servers players and the host PC use to find each other. With a Cloudflare
 * Realtime TURN key in .env the list carries short-lived TURN credentials, for the
 * connections STUN alone cannot make (symmetric NATs, networks that block UDP); without
 * one, or when Cloudflare cannot be reached, it is STUN only — as it always was.
 */
final class IceServers
{
    public const STUN_ONLY = [['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']]];

    private const CACHE_KEY = 'ice-servers';

    /** credentials are minted for this long… */
    private const CREDENTIAL_TTL_SECONDS = 7200;

    /** …and handed out for this long, so a copy is always good for well over an hour */
    private const CACHE_SECONDS = 600;

    /** a failed call is not retried on every request */
    private const FAILURE_CACHE_SECONDS = 60;

    /** @return list<array<string, mixed>> an RTCIceServer list */
    public function get(): array
    {
        $keyId = (string) config('services.cloudflare_turn.key_id');
        $token = (string) config('services.cloudflare_turn.api_token');
        if ($keyId === '' || $token === '') {
            return self::STUN_ONLY;
        }

        $cached = Cache::get(self::CACHE_KEY);
        if (is_array($cached)) {
            return $cached;
        }
        $servers = $this->fetch($keyId, $token);
        Cache::put(self::CACHE_KEY, $servers, $servers === self::STUN_ONLY ? self::FAILURE_CACHE_SECONDS : self::CACHE_SECONDS);

        return $servers;
    }

    /** @return list<array<string, mixed>> */
    private function fetch(string $keyId, string $token): array
    {
        try {
            $res = Http::withToken($token)->timeout(5)->acceptJson()->post(
                'https://rtc.live.cloudflare.com/v1/turn/keys/'.rawurlencode($keyId).'/credentials/generate-ice-servers',
                ['ttl' => self::CREDENTIAL_TTL_SECONDS],
            );
            $servers = $res->successful() ? $res->json('iceServers') : null;
            if (! is_array($servers) || $servers === []) {
                Log::warning('Cloudflare TURN credentials failed; falling back to STUN only', ['status' => $res->status()]);

                return self::STUN_ONLY;
            }

            return self::withoutPort53($servers);
        } catch (Throwable $e) {
            Log::warning('Cloudflare TURN credentials failed; falling back to STUN only', ['error' => $e->getMessage()]);

            return self::STUN_ONLY;
        }
    }

    /**
     * Browsers block port 53, and a TURN URL on it only times out: leave those out.
     *
     * @param  array<int, mixed>  $servers
     * @return list<array<string, mixed>>
     */
    private static function withoutPort53(array $servers): array
    {
        $out = [];
        foreach ($servers as $server) {
            if (! is_array($server) || ! isset($server['urls'])) {
                continue;
            }
            $urls = array_values(array_filter((array) $server['urls'], fn ($u) => is_string($u) && ! preg_match('/:53(\?|$)/', $u)));
            if ($urls !== []) {
                $out[] = [...$server, 'urls' => $urls];
            }
        }

        return $out === [] ? self::STUN_ONLY : $out;
    }
}
