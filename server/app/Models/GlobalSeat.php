<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One player currently inside the shared global world. Rows are the queue in arrival
 * order: the fresh seat with the lowest id is the host. Leaving deletes the row, so a
 * player who comes back — the old host included — joins the back of the queue.
 */
#[Fillable(['user_id', 'room_code', 'last_seen_at'])]
class GlobalSeat extends Model
{
    public const UPDATED_AT = null;

    /** a seat nobody has vouched for this long is gone (the host refreshes every 15 s) */
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
