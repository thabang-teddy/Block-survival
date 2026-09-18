<?php

namespace App\Support;

use App\Models\Setting;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * The hours during which players may be signed in ("operating time"). A window
 * belongs to the weekday it starts on, so 22:00–02:00 on Friday runs into
 * Saturday morning. Admins are exempt (see AccessPolicy).
 */
final class LoginWindow
{
    public const KEYS = ['login_window_enabled', 'login_window_start', 'login_window_end', 'login_window_days', 'login_window_timezone'];

    private const DAYS_IN_WEEK = 7;

    /**
     * @param  list<int>  $days  weekdays the window opens on, 0 = Sunday … 6 = Saturday
     */
    public function __construct(
        public readonly bool $enabled,
        public readonly string $start,
        public readonly string $end,
        public readonly array $days,
        public readonly string $timezone,
    ) {}

    public static function fromSettings(): self
    {
        $days = array_values(array_filter(
            array_map('intval', explode(',', Setting::get('login_window_days', '0,1,2,3,4,5,6') ?? '')),
            fn (int $d) => $d >= 0 && $d < self::DAYS_IN_WEEK,
        ));

        return new self(
            enabled: Setting::get('login_window_enabled', '0') === '1',
            start: Setting::get('login_window_start', '00:00') ?? '00:00',
            end: Setting::get('login_window_end', '23:59') ?? '23:59',
            days: $days,
            timezone: Setting::get('login_window_timezone') ?: config('app.timezone'),
        );
    }

    /** @return array<string, mixed> for the admin form */
    public function toArray(): array
    {
        return [
            'enabled' => $this->enabled,
            'start' => $this->start,
            'end' => $this->end,
            'days' => $this->days,
            'timezone' => $this->timezone,
        ];
    }

    public function isOpen(CarbonInterface $at): bool
    {
        if (! $this->enabled) {
            return true;
        }
        $local = CarbonImmutable::instance($at)->setTimezone($this->timezone);
        $minute = $local->hour * 60 + $local->minute;
        [$start, $end] = [$this->minutes($this->start), $this->minutes($this->end)];

        if ($start <= $end) {
            return $this->opensOn($local->dayOfWeek) && $minute >= $start && $minute < $end;
        }

        // overnight: tonight's window, or the tail of yesterday's
        $yesterday = ($local->dayOfWeek + self::DAYS_IN_WEEK - 1) % self::DAYS_IN_WEEK;

        return ($this->opensOn($local->dayOfWeek) && $minute >= $start)
            || ($this->opensOn($yesterday) && $minute < $end);
    }

    /** when the window next opens, or null if it is open now / never opens */
    public function nextOpening(CarbonInterface $at): ?CarbonImmutable
    {
        if ($this->isOpen($at) || $this->days === []) {
            return null;
        }
        $local = CarbonImmutable::instance($at)->setTimezone($this->timezone);
        [$hour, $minute] = array_map('intval', explode(':', $this->start));

        for ($i = 0; $i <= self::DAYS_IN_WEEK; $i++) {
            $candidate = $local->startOfDay()->addDays($i)->setTime($hour, $minute);
            if ($this->opensOn($candidate->dayOfWeek) && $candidate->greaterThan($local)) {
                return $candidate;
            }
        }

        return null;
    }

    /** "Wednesday 18:00" / "today 18:00", for the sign-in error */
    public function describeNextOpening(CarbonInterface $at): string
    {
        $next = $this->nextOpening($at);
        if ($next === null) {
            return 'The server is closed right now.';
        }
        $local = CarbonImmutable::instance($at)->setTimezone($this->timezone);
        $day = $next->isSameDay($local) ? 'today' : $next->format('l');

        return "The server is closed right now — it opens {$day} at {$next->format('H:i')} ({$this->timezone}).";
    }

    private function opensOn(int $dayOfWeek): bool
    {
        return in_array($dayOfWeek, $this->days, true);
    }

    private function minutes(string $hhmm): int
    {
        [$h, $m] = array_map('intval', explode(':', $hhmm));

        return $h * 60 + $m;
    }
}
