<?php

namespace App\Support;

use App\Models\Setting;

/**
 * The admin-tunable game clock: how long a day and a night last, and how the
 * night's zombies are scheduled. Both clients load these (the web game as a
 * page prop, the native one from /api/rules) and the host hands them to
 * joiners in the welcome, so everyone in a match plays the same rules.
 */
final class GameRules
{
    public const DEFAULTS = [
        'day_seconds' => 900,
        'night_seconds' => 300,
        'zombies_first_night' => 8,
        'zombies_per_night' => 6,
        'spawn_delay_seconds' => 2,
        'spawn_window_percent' => 70,
    ];

    /** inclusive bounds per key, shared by the form validation and the parser */
    public const BOUNDS = [
        'day_seconds' => [30, 7200],
        'night_seconds' => [30, 7200],
        'zombies_first_night' => [0, 200],
        'zombies_per_night' => [0, 100],
        'spawn_delay_seconds' => [0, 600],
        'spawn_window_percent' => [5, 100],
    ];

    /** @param  array<string, int>  $values  keyed like DEFAULTS */
    public function __construct(public readonly array $values) {}

    public static function fromSettings(): self
    {
        $values = [];
        foreach (self::DEFAULTS as $key => $default) {
            $raw = Setting::get('rules.'.$key);
            $values[$key] = self::clamp($key, is_numeric($raw) ? (int) $raw : $default);
        }

        return new self($values);
    }

    /** @param  array<string, mixed>  $data  validated form input */
    public static function save(array $data): void
    {
        $settings = [];
        foreach (self::DEFAULTS as $key => $default) {
            $settings['rules.'.$key] = (string) self::clamp($key, (int) ($data[$key] ?? $default));
        }
        Setting::setMany($settings);
    }

    /** @return array<string, array<int, mixed>> Laravel validation rules for the admin form */
    public static function validationRules(): array
    {
        $rules = [];
        foreach (self::BOUNDS as $key => [$min, $max]) {
            $rules[$key] = ['required', 'integer', "between:$min,$max"];
        }

        return $rules;
    }

    /** @return array<string, int> the shape both clients read (camelCase, seconds and counts) */
    public function toArray(): array
    {
        $v = $this->values;

        return [
            'daySeconds' => $v['day_seconds'],
            'nightSeconds' => $v['night_seconds'],
            'zombiesFirstNight' => $v['zombies_first_night'],
            'zombiesPerNight' => $v['zombies_per_night'],
            'spawnDelaySeconds' => $v['spawn_delay_seconds'],
            'spawnWindowPercent' => $v['spawn_window_percent'],
        ];
    }

    private static function clamp(string $key, int $value): int
    {
        [$min, $max] = self::BOUNDS[$key];

        return max($min, min($max, $value));
    }
}
