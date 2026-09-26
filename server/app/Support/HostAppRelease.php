<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The newest Block Survival Host installer: the GitHub Release tagged host-app-v<version>
 * that .github/workflows/host-app-release.yml publishes. The admin's Host PCs page shows
 * it and its download button redirects to the release's MSI — about 100 MB, which a
 * shared host has no business storing or streaming.
 */
final class HostAppRelease
{
    public const TAG_PREFIX = 'host-app-v';

    private const CACHE_KEY = 'host-app-release';

    private const CACHE_SECONDS = 600;

    /** a failed lookup is not retried on every page view */
    private const FAILURE_CACHE_SECONDS = 60;

    /**
     * @return array{version: string, name: string, size: int, published_at: string|null, url: string, page: string}|null
     */
    public function latest(): ?array
    {
        $cached = Cache::get(self::CACHE_KEY);
        if (is_array($cached)) {
            return $cached['release'];
        }
        [$release, $ok] = $this->fetch();
        Cache::put(self::CACHE_KEY, ['release' => $release], $ok ? self::CACHE_SECONDS : self::FAILURE_CACHE_SECONDS);

        return $release;
    }

    /** @return array{0: array<string, mixed>|null, 1: bool} the release, and whether GitHub answered */
    private function fetch(): array
    {
        $repo = (string) config('services.host_app.repo');
        if ($repo === '') {
            return [null, true];
        }
        try {
            $req = Http::timeout(5)->acceptJson()->withHeaders(['X-GitHub-Api-Version' => '2022-11-28']);
            $token = (string) config('services.host_app.github_token');
            if ($token !== '') {
                $req = $req->withToken($token);
            }
            $res = $req->get("https://api.github.com/repos/{$repo}/releases", ['per_page' => 30]);
            if (! $res->successful() || ! is_array($res->json())) {
                Log::warning('Could not list the host app releases', ['status' => $res->status()]);

                return [null, false];
            }

            return [self::pick($res->json()), true];
        } catch (Throwable $e) {
            Log::warning('Could not list the host app releases', ['error' => $e->getMessage()]);

            return [null, false];
        }
    }

    /**
     * The newest published host-app release that carries an MSI.
     *
     * @param  array<int, mixed>  $releases  GitHub's list, newest first
     * @return array{version: string, name: string, size: int, published_at: string|null, url: string, page: string}|null
     */
    public static function pick(array $releases): ?array
    {
        foreach ($releases as $r) {
            if (! is_array($r) || ($r['draft'] ?? false) || ($r['prerelease'] ?? false)) {
                continue;
            }
            $tag = (string) ($r['tag_name'] ?? '');
            if (! str_starts_with($tag, self::TAG_PREFIX)) {
                continue;
            }
            foreach ((array) ($r['assets'] ?? []) as $asset) {
                $name = (string) ($asset['name'] ?? '');
                $url = (string) ($asset['browser_download_url'] ?? '');
                if (str_ends_with(strtolower($name), '.msi') && str_starts_with($url, 'https://github.com/')) {
                    return [
                        'version' => substr($tag, strlen(self::TAG_PREFIX)),
                        'name' => $name,
                        'size' => (int) ($asset['size'] ?? 0),
                        'published_at' => $r['published_at'] ?? null,
                        'url' => $url,
                        'page' => (string) ($r['html_url'] ?? ''),
                    ];
                }
            }
        }

        return null;
    }
}
