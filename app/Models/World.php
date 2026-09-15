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
