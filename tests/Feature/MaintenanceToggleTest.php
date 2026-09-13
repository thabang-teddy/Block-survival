<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MaintenanceToggleTest extends TestCase
{
    use RefreshDatabase;

    public function test_site_serves_normally_when_toggle_is_off(): void
    {
        config(['app.maintenance.enabled' => false]);

        $this->get('/')->assertOk();
        $this->getJson('/api/leaderboard')->assertOk();
    }

    public function test_toggle_returns_503_for_pages_and_json(): void
    {
        config(['app.maintenance.enabled' => true]);

        $this->get('/')->assertStatus(503)->assertSee('The site is currently down')->assertSee(config('app.name'));
        $this->getJson('/api/leaderboard')->assertStatus(503)->assertJsonPath('message', 'Down for maintenance');
    }

    public function test_health_endpoint_stays_up_during_maintenance(): void
    {
        config(['app.maintenance.enabled' => true]);

        $this->get('/up')->assertOk();
    }
}
