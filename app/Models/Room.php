<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['code', 'host_peer_id', 'user_id', 'host_name', 'world_kind', 'players', 'expires_at', 'last_seen_at'])]
class Room extends Model
{
    /** rooms live this long unless the host refreshes them */
    public const TTL_HOURS = 2;

    /**
     * A room is *hosting* while its host has refreshed it this recently (the refresh runs
     * every 15 s) — the same rule as a global seat. `expires_at` only sweeps old rows.
     */
    public const HOSTING_SECONDS = GlobalSeat::STALE_SECONDS;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'last_seen_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        // a room is seen the moment it opens
        static::creating(function (Room $room) {
            $room->last_seen_at ??= now();
        });
    }

    /** @param Builder<Room> $query */
    public function scopeLive(Builder $query): void
    {
        $query->where('expires_at', '>', now());
    }

    /** @param Builder<Room> $query live, and its host has been heard from within HOSTING_SECONDS */
    public function scopeHosting(Builder $query): void
    {
        $query->live()->where('last_seen_at', '>', now()->subSeconds(self::HOSTING_SECONDS));
    }

    public function isHosting(): bool
    {
        return $this->expires_at->isFuture()
            && $this->last_seen_at !== null
            && $this->last_seen_at->gt(now()->subSeconds(self::HOSTING_SECONDS));
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
     * accepted invite — or, for the global world's room, anyone seated in it. Nobody but
     * the host gets in while the room is not hosting.
     */
    public function admits(?User $user): bool
    {
        if ($user === null) {
            return false;
        }
        if ($this->isHostedBy($user)) {
            return true;
        }
        if (! $this->isHosting()) {
            return false;
        }
        if ($this->isGlobal()) {
            return GlobalSeat::query()->fresh()->where('user_id', $user->id)->exists();
        }

        return $this->invites()->where('to_user_id', $user->id)->where('status', RoomInvite::ACCEPTED)->exists();
    }

    /**
     * Invites belong to the host, not to one room row: a host who opens a new own-world
     * room (after a reload, a rejoin or a crash) takes along the pending and accepted
     * invites of their rooms that are no longer hosting. One invite per invitee is kept,
     * the newest.
     */
    public function adoptInvitesOfHost(): void
    {
        if ($this->user_id === null || $this->isGlobal()) {
            return;
        }
        $stale = self::query()->where('user_id', $this->user_id)->whereKeyNot($this->id)
            ->where('world_kind', World::OWN)
            ->where(fn ($q) => $q->where('expires_at', '<=', now())
                ->orWhereNull('last_seen_at')
                ->orWhere('last_seen_at', '<=', now()->subSeconds(self::HOSTING_SECONDS)))
            ->pluck('id');
        if ($stale->isEmpty()) {
            return;
        }
        $moving = RoomInvite::query()->whereIn('room_id', $stale)
            ->whereIn('status', [RoomInvite::PENDING, RoomInvite::ACCEPTED])
            ->orderByDesc('id')->get();
        $taken = $this->invites()->pluck('to_user_id')->all();
        foreach ($moving as $invite) {
            if (in_array($invite->to_user_id, $taken, true)) {
                $invite->delete();

                continue;
            }
            $taken[] = $invite->to_user_id;
            $invite->update(['room_id' => $this->id]);
        }
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
