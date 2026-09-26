<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A host asking a player into their room (issue #5). Joining a room takes an
 * accepted invite: the room's peer id and its signalling mailbox are only open to
 * the host and to accepted invitees.
 */
#[Fillable(['room_id', 'from_user_id', 'to_user_id', 'status'])]
class RoomInvite extends Model
{
    public const PENDING = 'pending';

    public const ACCEPTED = 'accepted';

    public const DECLINED = 'declined';

    /** @return BelongsTo<Room, $this> */
    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    /** @return BelongsTo<User, $this> */
    public function from(): BelongsTo
    {
        return $this->belongsTo(User::class, 'from_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function to(): BelongsTo
    {
        return $this->belongsTo(User::class, 'to_user_id');
    }

    /** @param Builder<RoomInvite> $query */
    public function scopePending(Builder $query): void
    {
        $query->where('status', self::PENDING);
    }

    /** @return array<string, mixed> what the invitee's lobby shows */
    public function toPublic(): array
    {
        $room = $this->room;

        return [
            'id' => $this->id,
            'code' => $room->code,
            'host_name' => $room->host_name,
            'world_kind' => $room->world_kind,
            'players' => $room->players,
            'max_players' => \App\Http\Controllers\Api\RoomController::MAX_PLAYERS,
            'expires_at' => $room->expires_at->toIso8601String(),
            'status' => $this->status,
        ];
    }
}
