<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

/**
 * A host key: one PC process that hosts one global world (docs/pc-host-research.md §8).
 * A PC may run several, one per key. The key owns its world's save, seats and map seed.
 * Its state follows from the last heartbeat:
 *
 * - online: heard from within STALE_SECONDS — the PC runs the world;
 * - paused: went quiet (or announced a restart) — the world waits for it for as long
 *   as it takes;
 * - offline: shut down cleanly, marked offline by the admin, disabled or never started —
 *   nobody can enter the world until the PC runs it again. Browsers never host it.
 */
#[Fillable(['name', 'seed', 'token_hash', 'peer_id', 'version', 'room_code', 'players', 'last_seen_at', 'enabled', 'offline_at', 'paused_at', 'commands', 'stats'])]
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

    /** the classic island (ISLAND_LARGE.seed in resources/js/world/islandGen.ts) */
    public const CLASSIC_SEED = 11;

    /** seeds are 31-bit, as the game's newWorldSeed makes them */
    public const MAX_SEED = 0x7FFFFFFF;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'offline_at' => 'datetime',
            'paused_at' => 'datetime',
            'seed' => 'integer',
            'enabled' => 'boolean',
            'commands' => 'array',
            'stats' => 'array',
        ];
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * A new host key and its token, which is shown once and never stored in the clear.
     * The first key adopts a global save left without a host (from before there were
     * many, or after its host was removed while the migration ran).
     *
     * @return array{0: self, 1: string}
     */
    public static function register(string $name, ?int $seed = null): array
    {
        $token = Str::random(self::TOKEN_LENGTH);
        $first = ! static::query()->exists();
        $host = static::create([
            'name' => $name,
            'seed' => $seed ?? ($first ? self::CLASSIC_SEED : random_int(1, self::MAX_SEED)),
            'token_hash' => self::hashToken($token),
        ]);
        if ($first) {
            World::query()->whereNull('user_id')->whereNull('game_host_id')->where('kind', World::GLOBAL)
                ->update(['game_host_id' => $host->id]);
        }

        return [$host, $token];
    }

    /** @return HasOne<World, $this> the world's save, once the PC has uploaded one */
    public function world(): HasOne
    {
        return $this->hasOne(World::class)->whereNull('user_id')->where('kind', World::GLOBAL);
    }

    /** @return HasMany<GlobalSeat, $this> the players inside the world */
    public function seats(): HasMany
    {
        return $this->hasMany(GlobalSeat::class);
    }

    /** what the admin list shows instead of the token: enough to tell keys apart, useless to sign in with */
    public function fingerprint(): string
    {
        return substr((string) $this->token_hash, 0, 8);
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

    /** online or paused: players may enter (and wait while it is paused) */
    public function isOpen(): bool
    {
        return $this->state() !== self::OFFLINE;
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
            'fingerprint' => $this->fingerprint(),
            'seed' => $this->seed,
            'state' => $this->state(),
            'enabled' => $this->enabled,
            'version' => $this->version,
            'players' => $this->players,
            'last_seen_at' => $this->last_seen_at?->toIso8601String(),
            'offline_at' => $this->offline_at?->toIso8601String(),
            'stats' => $this->stats,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
