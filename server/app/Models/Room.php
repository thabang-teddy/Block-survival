<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['code', 'host_peer_id', 'user_id', 'host_name', 'world_kind', 'players', 'expires_at'])]
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

    /** @return HasMany<RoomInvite, $this> */
    public function invites(): HasMany
    {
        return $this->hasMany(RoomInvite::class);
    }

    public function isHostedBy(?User $user): bool
    {
        return $user !== null && $this->user_id !== null && $this->user_id === $user->id;
    }

    public function isGlobal(): bool
    {
        return $this->world_kind === World::GLOBAL;
    }

    /**
     * Who may resolve the room and use its mailbox: the host, or a player holding an
     * accepted invite — or, for the global world's room, anyone seated in it.
     */
    public function admits(?User $user): bool
    {
        if ($user === null) {
            return false;
        }
        if ($this->isHostedBy($user)) {
            return true;
        }
        if ($this->isGlobal()) {
            return GlobalSeat::query()->fresh()->where('user_id', $user->id)->exists();
        }

        return $this->invites()->where('to_user_id', $user->id)->where('status', RoomInvite::ACCEPTED)->exists();
    }

    /** @return array<string, mixed> what joiners and the lobby see */
    public function toPublic(): array
    {
        return [
            'code' => $this->code,
            'host_peer_id' => $this->host_peer_id,
            'host_name' => $this->host_name,
            'world_kind' => $this->world_kind,
            'players' => $this->players,
            'expires_at' => $this->expires_at->toIso8601String(),
        ];
    }
}
