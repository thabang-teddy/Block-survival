<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Models\User;
use App\Support\GameRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** The admin-tunable day/night clock and zombie schedule (App\Support\GameRules). */
class GameRulesTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->admin()->create();
    }

    public function test_the_defaults_apply_until_an_admin_saves_rules(): void
    {
        $this->assertSame(GameRules::DEFAULTS, GameRules::fromSettings()->values);
        $this->assertSame([
            'daySeconds' => 900, 'nightSeconds' => 300, 'zombiesFirstNight' => 8,
            'zombiesPerNight' => 6, 'spawnDelaySeconds' => 2, 'spawnWindowPercent' => 70,
        ], GameRules::fromSettings()->toArray());
    }

    public function test_admins_see_save_and_reset_the_rules_and_players_may_not(): void
    {
        $player = User::factory()->create();
        $this->signIn($player)->get('/admin/rules')->assertForbidden();
        $this->signIn($player)->put('/admin/rules')->assertForbidden();

        $admin = $this->admin();
        $this->actingAs($admin)->get('/admin/rules')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Rules')
            ->where('rules.day_seconds', 900)
            ->where('defaults.night_seconds', 300)
            ->where('bounds.day_seconds', [30, 7200]));

        $this->actingAs($admin)->put('/admin/rules', [
            'day_seconds' => 120, 'night_seconds' => 60, 'zombies_first_night' => 3,
            'zombies_per_night' => 2, 'spawn_delay_seconds' => 5, 'spawn_window_percent' => 50,
        ])->assertRedirect()->assertSessionHas('status');

        $this->assertSame('120', Setting::get('rules.day_seconds'));
        $this->assertSame([
            'daySeconds' => 120, 'nightSeconds' => 60, 'zombiesFirstNight' => 3,
            'zombiesPerNight' => 2, 'spawnDelaySeconds' => 5, 'spawnWindowPercent' => 50,
        ], GameRules::fromSettings()->toArray());

        $this->actingAs($admin)->put('/admin/rules', [
            'day_seconds' => 1, 'night_seconds' => 'long', 'zombies_first_night' => -1,
            'zombies_per_night' => 2, 'spawn_delay_seconds' => 5, 'spawn_window_percent' => 101,
        ])->assertSessionHasErrors(['day_seconds', 'night_seconds', 'zombies_first_night', 'spawn_window_percent']);

        // saving the defaults again is a plain save, not a special case
        $this->actingAs($admin)->put('/admin/rules', GameRules::DEFAULTS)->assertRedirect();
        $this->assertSame(GameRules::DEFAULTS, GameRules::fromSettings()->values);
    }

    public function test_the_game_page_and_the_api_carry_the_rules(): void
    {
        Setting::setMany(['rules.night_seconds' => '45', 'rules.day_seconds' => 'garbage']);
        $player = User::factory()->create();

        $this->signIn($player)->get('/')->assertInertia(fn (Assert $page) => $page
            ->where('rules.nightSeconds', 45)
            ->where('rules.daySeconds', 900)); // unreadable values fall back to the default

        $this->signIn($player)->getJson('/api/rules')->assertOk()
            ->assertJsonPath('rules.nightSeconds', 45)
            ->assertJsonPath('rules.spawnWindowPercent', 70);
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/rules')->assertUnauthorized();
    }
}
