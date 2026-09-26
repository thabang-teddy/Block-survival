<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A saved world: the gzipped save the host uploads (table `saves`). Every player has
 * their own world (`own`, a random seed, `user_id` set); the shared global world
 * (`global`, the classic seed) is one row with no owner, uploaded by whoever hosts it.
 */
#[Fillable(['user_id', 'kind', 'payload', 'size', 'night', 'seconds', 'players'])]
#[Hidden(['payload'])]
class World extends Model
{
    /** gzipped payload limit (bytes): v3 saves also hold every visitor's gear and the live world */
    public const MAX_BYTES = 4 * 1024 * 1024;

    public const OWN = 'own';

    public const GLOBAL = 'global';

    public const KINDS = [self::OWN, self::GLOBAL];

    protected $table = 'saves';

    public static function isKind(string $kind): bool
    {
        return in_array($kind, self::KINDS, true);
    }

    /** the shared global world's row, or null before its first save */
    public static function global(): ?self
    {
        return static::query()->whereNull('user_id')->where('kind', self::GLOBAL)->first();
    }

    /**
     * Why these bytes cannot be stored as a save, as [message, HTTP status], or null.
     *
     * @return array{0: string, 1: int}|null
     */
    public static function uploadProblem(string $bytes): ?array
    {
        if ($bytes === '' || strlen($bytes) > self::MAX_BYTES) {
            return ['Save must be between 1 byte and '.(self::MAX_BYTES / 1024 / 1024).' MB.', 413];
        }
        if (! str_starts_with($bytes, "\x1f\x8b")) {
            return ['Save must be gzip-compressed JSON.', 422];
        }

        return null;
    }

    /**
     * Replace a save (a player's own world, or the global one when `$userId` is null).
     *
     * @param  array{night?: int, seconds?: int}  $meta
     */
    public static function put(?int $userId, string $kind, string $bytes, array $meta): self
    {
        return static::query()->updateOrCreate(
            ['user_id' => $userId, 'kind' => $kind],
            [
                'payload' => base64_encode($bytes),
                'size' => strlen($bytes),
                'night' => (int) ($meta['night'] ?? 0),
                'seconds' => (int) ($meta['seconds'] ?? 0),
                'players' => self::playerCount($bytes),
            ],
        );
    }

    /** how many accounts the save holds gear for; older formats held only the host */
    private static function playerCount(string $gzip): int
    {
        $json = @gzdecode($gzip);
        if ($json === false) {
            return 1;
        }
        $data = json_decode($json, true);
        if (! is_array($data) || ! isset($data['players']) || ! is_array($data['players'])) {
            return 1;
        }

        return max(1, min(65535, count($data['players'])));
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array<string, mixed> what the lobby and the admin show */
    public function meta(): array
    {
        return [
            'kind' => $this->kind,
            'size' => $this->size,
            'night' => $this->night,
            'seconds' => $this->seconds,
            'players' => (int) ($this->players ?? 1),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
