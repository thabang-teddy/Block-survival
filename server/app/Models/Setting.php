<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

/**
 * Admin-editable key/value settings. The whole table is small and read on every
 * request (the login window), so it is cached as one array.
 */
#[Fillable(['key', 'value'])]
class Setting extends Model
{
    private const CACHE_KEY = 'settings.all';

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $incrementing = false;

    /** @return array<string, string> */
    public static function allValues(): array
    {
        return Cache::rememberForever(self::CACHE_KEY, fn () => self::query()->pluck('value', 'key')->all());
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        return self::allValues()[$key] ?? $default;
    }

    /** @param array<string, string> $values */
    public static function setMany(array $values): void
    {
        foreach ($values as $key => $value) {
            self::query()->updateOrCreate(['key' => $key], ['value' => $value]);
        }
        Cache::forget(self::CACHE_KEY);
    }
}
