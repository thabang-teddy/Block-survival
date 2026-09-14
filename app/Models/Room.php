<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['code', 'host_peer_id', 'user_id', 'host_name', 'players', 'expires_at'])]
class Room extends Model
{
    /** rooms live this long unless the host refreshes them */
    public const TTL_HOURS = 2;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['expires_at' => 'datetime'];
    }

    /** @param Builder<Room> $query */
    public function scopeLive(Builder $query): void
    {
        $query->where('expires_at', '>', now());
    }
}
