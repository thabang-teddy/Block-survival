<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** The three sign-in gates: approved browser, open login window, enabled account. */
class DeviceApprovalTest extends TestCase
{
    use RefreshDatabase;

    private const CREDENTIALS = ['email' => 'teddy@example.com', 'password' => 'correct-horse'];

    private function player(): User
    {
        return User::factory()->create(['name' => 'Teddy', ...self::CREDENTIALS]);
    }

    // ------------------------------------------------------------ device approval
    public function test_a_new_browser_is_parked_until_an_admin_approves_it(): void
    {
        $user = $this->player();

        $this->post('/login', self::CREDENTIALS)->assertRedirect('/pending-approval')->assertCookie('bs_device');
        $this->assertGuest();
        $device = Device::sole();
        $this->assertSame($user->id, $device->user_id);
        $this->assertNull($device->approved_at);

        // the pending page identifies the browser by its cookie and reports its state
        $this->withCredentials()->withCookie('bs_device', $device->token);
        $this->get('/pending-approval')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('PendingApproval')->where('device.id', $device->id)->where('device.approved', false));
        $this->getJson('/pending-approval/status')->assertOk()->assertJson(['known' => true, 'approved' => false]);

        $device->update(['approved_at' => now()]);
        $this->getJson('/pending-approval/status')->assertJson(['approved' => true]);
        $this->post('/login', self::CREDENTIALS)->assertRedirect('/');
        $this->assertAuthenticated();
        $this->assertSame(1, Device::count()); // the same browser, not a second row
        $this->assertNotNull($user->fresh()->last_login_at);
    }

    public function test_the_pending_page_needs_a_device_cookie(): void
    {
        $this->get('/pending-approval')->assertRedirect('/login');
        $this->getJson('/pending-approval/status')->assertJson(['known' => false, 'approved' => false]);
    }

    public function test_a_malformed_or_unknown_cookie_is_ignored_and_replaced(): void
    {
        $this->player();
        $this->withCookie('bs_device', 'not-a-token');
        $this->post('/login', self::CREDENTIALS)->assertRedirect('/pending-approval');
        $this->assertSame(1, Device::count());
        $this->assertMatchesRegularExpression(Device::TOKEN_PATTERN, Device::sole()->token);
    }

    public function test_revoking_a_browser_ends_its_running_session(): void
    {
        $user = $this->player();
        $device = $this->device($user);
        $this->actingAs($user)->get('/')->assertOk();

        $device->delete();
        $this->actingAs($user)->get('/')->assertRedirect('/pending-approval');
        $this->assertGuest();
        $this->actingAs($user)->getJson('/api/leaderboard')->assertForbidden();
    }

    public function test_admins_bypass_device_approval(): void
    {
        $admin = User::factory()->admin()->create(self::CREDENTIALS);
        $this->post('/login', self::CREDENTIALS)->assertRedirect('/');
        $this->assertAuthenticated();
        $this->assertNull(Device::sole()->approved_at); // still listed for the record
        $this->actingAs($admin)->get('/')->assertOk();
    }

    public function test_the_env_admin_is_an_admin_without_the_flag(): void
    {
        config(['admin.email' => 'TEDDY@example.com']);
        $this->player();
        $this->post('/login', self::CREDENTIALS)->assertRedirect('/');
        $this->actingAs(User::sole())->get('/admin')->assertOk();
    }

    // ------------------------------------------------------------ disabled accounts
    public function test_a_disabled_account_cannot_sign_in_and_loses_its_session(): void
    {
        $user = $this->player();
        $this->device($user);
        $this->actingAs($user)->get('/')->assertOk();

        $user->update(['is_disabled' => true]);
        $this->actingAs($user)->get('/')->assertRedirect('/login');
        $this->assertGuest();
        $this->post('/login', self::CREDENTIALS)->assertSessionHasErrors(['email' => 'This account has been disabled.']);
    }

    // ------------------------------------------------------------ login window
    private function weekdayEvenings(): void
    {
        Setting::setMany([
            'login_window_enabled' => '1',
            'login_window_start' => '18:00',
            'login_window_end' => '22:00',
            'login_window_days' => '1,2,3,4,5',
            'login_window_timezone' => 'UTC',
        ]);
    }

    public function test_sign_in_is_refused_outside_the_login_window(): void
    {
        $this->weekdayEvenings();
        $user = $this->player();
        $this->device($user);

        Carbon::setTestNow('2026-09-16 12:00:00'); // Wednesday noon
        $this->post('/login', self::CREDENTIALS)
            ->assertSessionHasErrors(['email' => 'The server is closed right now — it opens today at 18:00 (UTC).']);
        $this->assertGuest();

        Carbon::setTestNow('2026-09-16 19:00:00');
        $this->post('/login', self::CREDENTIALS)->assertRedirect('/');
        $this->assertAuthenticated();
    }

    public function test_a_session_ends_when_the_window_closes_but_admins_stay(): void
    {
        $this->weekdayEvenings();
        $user = $this->player();
        $this->device($user);
        $admin = User::factory()->admin()->create();

        Carbon::setTestNow('2026-09-16 21:00:00');
        $this->actingAs($user)->get('/')->assertOk();

        Carbon::setTestNow('2026-09-16 22:00:00');
        $this->actingAs($user)->getJson('/api/leaderboard')->assertForbidden()
            ->assertJsonPath('message', 'The server is closed right now — it opens Thursday at 18:00 (UTC).');
        $this->actingAs($user)->get('/')->assertRedirect('/login');
        $this->assertGuest();
        $this->actingAs($admin)->get('/')->assertOk();
    }
}
