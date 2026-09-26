<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * The PC that hosts the global world (docs/pc-host-research.md). There is at most one.
 * Its state follows from the last heartbeat:
 *
 * - online: heard from within STALE_SECONDS — the PC holds the global world;
 * - paused: holds the world but went quiet (or announced a restart) — the world waits
 *   for it for as long as it takes; browsers never take over from a paused PC;
 * - offline: shut down cleanly, released by the admin, disabled or never registered —
 *   the browser queue hosts the world, as it did before the PC.
 */
#[Fillable(['name', 'token_hash', 'peer_id', 'version', 'room_code', 'players', 'last_seen_at', 'enabled', 'offline_at', 'paused_at', 'commands', 'stats'])]
#[Hidden(['token_hash'])]
class GameHost extends Model
{
    public const ONLINE = 'online';

    public const PAUSED = 'paused';

    public const OFFLINE = 'offline';

    /** the PC's heartbeat runs every 15 s; three missed ones and it counts as paused */
    public const STALE_SECONDS = 45;

    public const TOKEN_LENGTH = 48;

    public const COMMAND_RESET = 'reset';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'offline_at' => 'datetime',
            'paused_at' => 'datetime',
            'enabled' => 'boolean',
            'commands' => 'array',
            'stats' => 'array',
        ];
    }

    /** the one host, if an admin has created it */
    public static function current(): ?self
    {
        return static::query()->orderBy('id')->first();
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** a new host and its token, which is shown once and never stored in the clear */
    public static function register(string $name): array
    {
        $token = Str::random(self::TOKEN_LENGTH);
        $host = static::create(['name' => $name, 'token_hash' => self::hashToken($token)]);

        return [$host, $token];
    }

    public function rotateToken(): string
    {
        $token = Str::random(self::TOKEN_LENGTH);
        $this->update(['token_hash' => self::hashToken($token)]);

        return $token;
    }

    public static function findByToken(?string $token): ?self
    {
        if (! is_string($token) || strlen($token) !== self::TOKEN_LENGTH) {
            return null;
        }

        return static::query()->where('token_hash', self::hashToken($token))->first();
    }

    /** heard from recently, whatever it said */
    public function isAlive(): bool
    {
        return $this->last_seen_at !== null && $this->last_seen_at->gt(now()->subSeconds(self::STALE_SECONDS));
    }

    public function state(): string
    {
        if (! $this->enabled || $this->last_seen_at === null || $this->offline_at !== null) {
            return self::OFFLINE;
        }
        if ($this->paused_at !== null || ! $this->isAlive()) {
            return self::PAUSED;
        }

        return self::ONLINE;
    }

    /** online or paused: the global world is the PC's, and no browser may host it */
    public function holdsWorld(): bool
    {
        return $this->state() !== self::OFFLINE;
    }

    /** released or shut down cleanly, but running again: it takes the world back once browsers are done with it */
    public function isStandingBy(): bool
    {
        return $this->enabled && $this->offline_at !== null && $this->paused_at === null && $this->isAlive();
    }

    public function queueCommand(string $command): void
    {
        $this->update(['commands' => array_values(array_unique([...($this->commands ?? []), $command]))]);
    }

    /** @return list<string> the waiting commands, now handed over */
    public function takeCommands(): array
    {
        $commands = $this->commands ?? [];
        $this->commands = null;

        return $commands;
    }

    /** @return array<string, mixed> what the admin page shows */
    public function toAdmin(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'state' => $this->state(),
            'standing_by' => $this->isStandingBy(),
            'enabled' => $this->enabled,
            'version' => $this->version,
            'players' => $this->players,
            'last_seen_at' => $this->last_seen_at?->toIso8601String(),
            'offline_at' => $this->offline_at?->toIso8601String(),
            'stats' => $this->stats,
        ];
    }
}
