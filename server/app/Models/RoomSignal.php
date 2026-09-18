<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * One WebRTC signalling message (offer / answer / ICE candidate) waiting for
 * the peer it is addressed to. Peers poll their mailbox with an id cursor; the
 * room code is the only secret, exactly as it is for joining.
 */
#[Fillable(['room_code', 'from_peer', 'to_peer', 'type', 'data'])]
class RoomSignal extends Model
{
    public const UPDATED_AT = null;

    /** the most rows one poll returns; a full handshake is ~20 */
    public const PAGE = 50;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['data' => 'array', 'created_at' => 'datetime'];
    }

    /** @param Builder<RoomSignal> $query */
    public function scopeAddressedTo(Builder $query, string $code, string $peer, int $after): void
    {
        $query->where('room_code', $code)->where('to_peer', $peer)->where('id', '>', $after)->orderBy('id');
    }

    /** Signals older than a room's lifetime can never be collected — drop them. */
    public static function pruneStale(): void
    {
        static::query()->where('created_at', '<', now()->subHours(Room::TTL_HOURS))->delete();
    }

    /** @return array<string, mixed> */
    public function toPublic(): array
    {
        return ['id' => $this->id, 'from' => $this->from_peer, 'type' => $this->type, 'data' => $this->data];
    }
}
