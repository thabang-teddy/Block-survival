<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A browser ("PC") that has signed in. Identified by a random token kept in an
 * encrypted cookie; an admin has to approve it before its user may play.
 */
#[Fillable(['token', 'user_id', 'label', 'user_agent', 'ip', 'last_seen_at', 'approved_at', 'approved_by'])]
class Device extends Model
{
    public const TOKEN_LENGTH = 64;

    public const TOKEN_PATTERN = '/^[A-Za-z0-9]{64}$/';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime', 'approved_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<User, $this> */
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /** @param Builder<Device> $query */
    public function scopeApproved(Builder $query): void
    {
        $query->whereNotNull('approved_at');
    }

    /** @param Builder<Device> $query */
    public function scopePending(Builder $query): void
    {
        $query->whereNull('approved_at');
    }

    public function isApproved(): bool
    {
        return $this->approved_at !== null;
    }

    public static function newToken(): string
    {
        return Str::random(self::TOKEN_LENGTH);
    }

    /** a cookie value is only trusted if it looks like a token and exists */
    public static function findByToken(?string $token): ?self
    {
        if (! is_string($token) || ! preg_match(self::TOKEN_PATTERN, $token)) {
            return null;
        }

        return self::query()->where('token', $token)->first();
    }

    /** forget browsers nobody approved; there is no scheduler on shared hosting */
    public static function pruneStale(): void
    {
        self::query()->pending()
            ->where('created_at', '<', now()->subDays((int) config('admin.device_pending_days')))
            ->delete();
    }
}
