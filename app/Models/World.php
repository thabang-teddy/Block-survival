<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A player's one world: the gzipped save the host uploads (table `saves`). */
#[Fillable(['user_id', 'payload', 'size', 'night', 'seconds', 'players'])]
#[Hidden(['payload'])]
class World extends Model
{
    /** gzipped payload limit (bytes): v3 saves also hold every visitor's gear and the live world */
    public const MAX_BYTES = 4 * 1024 * 1024;

    protected $table = 'saves';

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array<string, mixed> what the lobby and the admin show */
    public function meta(): array
    {
        return ['size' => $this->size, 'night' => $this->night, 'seconds' => $this->seconds, 'players' => (int) ($this->players ?? 1), 'updated_at' => $this->updated_at?->toIso8601String()];
    }
}
