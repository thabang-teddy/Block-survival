<?php

namespace Tests\Unit;

use App\Support\LoginWindow;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

class LoginWindowTest extends TestCase
{
    private const TZ = 'Africa/Johannesburg';

    /** @param list<int> $days */
    private function window(string $start, string $end, array $days = [0, 1, 2, 3, 4, 5, 6], bool $enabled = true): LoginWindow
    {
        return new LoginWindow($enabled, $start, $end, $days, self::TZ);
    }

    private function at(string $local): CarbonImmutable
    {
        return CarbonImmutable::parse($local, self::TZ);
    }

    public function test_a_disabled_window_is_always_open(): void
    {
        $w = $this->window('09:00', '10:00', [], enabled: false);
        $this->assertTrue($w->isOpen($this->at('2026-09-16 03:00')));
        $this->assertNull($w->nextOpening($this->at('2026-09-16 03:00')));
    }

    public function test_a_same_day_window_is_half_open_and_honours_the_day_list(): void
    {
        $w = $this->window('18:00', '22:00', days: [1, 2, 3, 4, 5]); // weekday evenings
        $wednesday = '2026-09-16';
        $this->assertFalse($w->isOpen($this->at("$wednesday 17:59")));
        $this->assertTrue($w->isOpen($this->at("$wednesday 18:00")));
        $this->assertTrue($w->isOpen($this->at("$wednesday 21:59")));
        $this->assertFalse($w->isOpen($this->at("$wednesday 22:00")));
        $this->assertFalse($w->isOpen($this->at('2026-09-19 19:00'))); // Saturday
    }

    public function test_an_overnight_window_belongs_to_the_day_it_starts_on(): void
    {
        $w = $this->window('22:00', '02:00', days: [5]); // Friday night only
        $this->assertTrue($w->isOpen($this->at('2026-09-18 23:30')));  // Friday
        $this->assertTrue($w->isOpen($this->at('2026-09-19 01:30')));  // Saturday small hours
        $this->assertFalse($w->isOpen($this->at('2026-09-19 02:00')));
        $this->assertFalse($w->isOpen($this->at('2026-09-19 23:30'))); // Saturday night is not listed
        $this->assertFalse($w->isOpen($this->at('2026-09-18 12:00')));
    }

    public function test_the_check_converts_to_the_window_timezone(): void
    {
        $w = $this->window('09:00', '10:00');
        // 07:30 UTC is 09:30 in Johannesburg
        $this->assertTrue($w->isOpen(CarbonImmutable::parse('2026-09-16 07:30', 'UTC')));
        $this->assertFalse($w->isOpen(CarbonImmutable::parse('2026-09-16 09:30', 'UTC')));
    }

    public function test_next_opening_is_today_later_this_week_or_never(): void
    {
        $w = $this->window('18:00', '22:00', days: [1, 3]); // Monday and Wednesday
        $monday = $this->at('2026-09-14 10:00');
        $this->assertSame('2026-09-14 18:00', $w->nextOpening($monday)?->format('Y-m-d H:i'));
        $this->assertStringContainsString('opens today at 18:00', $w->describeNextOpening($monday));

        $tuesday = $this->at('2026-09-15 10:00');
        $this->assertSame('2026-09-16 18:00', $w->nextOpening($tuesday)?->format('Y-m-d H:i'));
        $this->assertStringContainsString('opens Wednesday at 18:00', $w->describeNextOpening($tuesday));

        // late on Wednesday, the next one is Monday again
        $this->assertSame('2026-09-21 18:00', $w->nextOpening($this->at('2026-09-16 23:00'))?->format('Y-m-d H:i'));

        $this->assertNull($w->nextOpening($this->at('2026-09-14 19:00'))); // open now
        $never = $this->window('18:00', '22:00', days: []);
        $this->assertNull($never->nextOpening($monday));
        $this->assertSame('The server is closed right now.', $never->describeNextOpening($monday));
    }
}
