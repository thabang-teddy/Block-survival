<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Models\Device;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** The dev-only guest button on the sign-in page. */
class GuestLoginTest extends TestCase
{
    use RefreshDatabase;

    /** the config flag is derived from APP_ENV at boot; tests flip it directly */
    private function inEnvironment(string $env): void
    {
        config(['admin.guest_login' => $env === 'local']);
    }

    public function test_in_dev_the_first_click_creates_the_guest_and_every_click_signs_in_as_it(): void
    {
        $this->inEnvironment('local');
        $this->get('/login')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Login')->where('guestLogin', true)->where('guestExists', false));

        // first click: the account appears, the browser is approved, the game page opens
        $this->post('/login/guest')->assertRedirect('/')->assertCookie('bs_device');
        $this->assertAuthenticated();
        $guest = User::sole();
        $this->assertSame(AuthController::GUEST_EMAIL, $guest->email);
        $this->assertSame(AuthController::GUEST_NAME, $guest->name);
        $this->assertFalse($guest->isAdmin());
        $this->assertNotNull($guest->last_login_at);
        $device = Device::sole();
        $this->assertNotNull($device->approved_at);
        // the approved browser (identified by its cookie) reaches the game page
        $this->withCredentials()->withCookie('bs_device', $device->token)->get('/')->assertOk();

        // second click, fresh session: the same account, no second user
        $this->post('/logout');
        $this->assertGuest();
        $this->get('/login')->assertInertia(fn (Assert $page) => $page->where('guestExists', true));
        $this->post('/login/guest')->assertRedirect('/');
        $this->assertAuthenticatedAs($guest);
        $this->assertSame(1, User::count());
    }

    public function test_the_guest_button_and_route_are_gone_outside_dev(): void
    {
        foreach (['staging', 'production', 'testing'] as $env) {
            $this->inEnvironment($env);
            $this->get('/login')->assertOk()->assertInertia(fn (Assert $page) => $page->where('guestLogin', false));
            $this->post('/login/guest')->assertNotFound();
            $this->assertGuest();
            $this->assertSame(0, User::count());
        }
    }

    public function test_a_disabled_guest_account_stays_out(): void
    {
        $this->inEnvironment('local');
        User::factory()->create(['email' => AuthController::GUEST_EMAIL, 'name' => 'Guest', 'is_disabled' => true]);
        $this->from('/login')->post('/login/guest')->assertRedirect('/login')->assertSessionHasErrors('email');
        $this->assertGuest();
    }
}
