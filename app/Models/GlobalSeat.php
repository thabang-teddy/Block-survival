<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One player currently inside a global world (one seat per player, so one world at a
 * time). The PC's heartbeat vouches for everyone connected to it; a player waiting on a
 * paused PC keeps their seat by asking. Leaving deletes the row.
 */
#[Fillable(['user_id', 'game_host_id', 'last_seen_at'])]
class GlobalSeat extends Model
{
    public const UPDATED_AT = null;

    /** a seat nobody has vouched for this long is gone (the PC vouches every 15 s) */
    public const STALE_SECONDS = 45;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime', 'created_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<GameHost, $this> */
    public function host(): BelongsTo
    {
        return $this->belongsTo(GameHost::class, 'game_host_id');
    }

    /** @param Builder<GlobalSeat> $query */
    public function scopeFresh(Builder $query): void
    {
        $query->where('last_seen_at', '>', now()->subSeconds(self::STALE_SECONDS));
    }

    /** @param Builder<GlobalSeat> $query */
    public function scopeStale(Builder $query): void
    {
        $query->where('last_seen_at', '<=', now()->subSeconds(self::STALE_SECONDS));
    }

    public function isFresh(): bool
    {
        return $this->last_seen_at->gt(now()->subSeconds(self::STALE_SECONDS));
    }
}
