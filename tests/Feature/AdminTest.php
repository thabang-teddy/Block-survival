<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Room;
use App\Models\RoomSignal;
use App\Models\Setting;
use App\Models\User;
use App\Support\LoginWindow;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class AdminTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->admin()->create(['name' => 'Boss', 'email' => 'boss@example.com']);
    }

    // ------------------------------------------------------------ access
    public function test_the_admin_section_is_for_admins_only(): void
    {
        $this->get('/admin')->assertRedirect('/login');
        $this->signIn(User::factory()->create())->get('/admin')->assertForbidden();
        $this->signIn(User::factory()->create())->put('/admin/login-window')->assertForbidden();

        $this->actingAs($this->admin())->get('/admin')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Admin')
            ->where('auth.user.is_admin', true)
            ->where('loginWindow.enabled', false)
            ->has('devices', 2)->has('users', 3)->has('rooms', 0)); // the two players above and their browsers
    }

    public function test_the_lobby_knows_whether_the_player_is_an_admin(): void
    {
        $this->signIn(User::factory()->create())->get('/')->assertInertia(fn (Assert $page) => $page->where('auth.user.is_admin', false));
        $this->actingAs($this->admin())->get('/')->assertInertia(fn (Assert $page) => $page->where('auth.user.is_admin', true));
    }

    // ------------------------------------------------------------ login window
    public function test_operating_hours_are_saved_and_validated(): void
    {
        $admin = $this->admin();
        $this->actingAs($admin)->put('/admin/login-window', [
            'enabled' => true, 'start' => '18:00', 'end' => '02:00', 'days' => [5, 6], 'timezone' => 'Africa/Johannesburg',
        ])->assertRedirect()->assertSessionHas('status', 'Operating hours saved.');

        $window = LoginWindow::fromSettings();
        $this->assertTrue($window->enabled);
        $this->assertSame(['18:00', '02:00', [5, 6], 'Africa/Johannesburg'], [$window->start, $window->end, $window->days, $window->timezone]);
        $this->assertSame('18:00', Setting::get('login_window_start'));

        $this->actingAs($admin)->put('/admin/login-window', [
            'enabled' => true, 'start' => '25:00', 'end' => '2:00', 'days' => [7], 'timezone' => 'Mars/Olympus',
        ])->assertSessionHasErrors(['start', 'end', 'days.0', 'timezone']);
    }

    // ------------------------------------------------------------ devices
    public function test_devices_are_listed_pending_first_and_can_be_approved_labelled_and_removed(): void
    {
        $admin = $this->admin();
        $player = User::factory()->create();
        $approved = Device::create(['token' => Device::newToken(), 'user_id' => $player->id, 'approved_at' => now()]);
        $pending = Device::create(['token' => Device::newToken(), 'user_id' => $player->id]);

        $this->actingAs($admin)->get('/admin')->assertInertia(fn (Assert $page) => $page
            ->has('devices', 2)
            ->where('devices.0.id', $pending->id)->where('devices.0.approved_at', null)
            ->where('devices.0.user.name', $player->name)
            ->where('devices.1.id', $approved->id));

        $this->actingAs($admin)->post("/admin/devices/{$pending->id}/approve")->assertRedirect();
        $this->assertNotNull($pending->fresh()->approved_at);
        $this->assertSame($admin->id, $pending->fresh()->approved_by);

        $this->actingAs($admin)->patch("/admin/devices/{$pending->id}", ['label' => 'Living room PC'])->assertRedirect();
        $this->assertSame('Living room PC', $pending->fresh()->label);
        $this->actingAs($admin)->patch("/admin/devices/{$pending->id}", ['label' => str_repeat('x', 41)])->assertSessionHasErrors('label');

        $this->actingAs($admin)->delete("/admin/devices/{$approved->id}")->assertRedirect();
        $this->assertNull($approved->fresh());
        $this->actingAs($admin)->delete('/admin/devices/999')->assertNotFound();
    }

    public function test_stale_pending_devices_are_swept_when_the_admin_page_opens(): void
    {
        $stale = Device::forceCreate(['token' => Device::newToken(), 'created_at' => now()->subDays(31)]);
        $recent = Device::forceCreate(['token' => Device::newToken(), 'created_at' => now()->subDays(29)]);
        $oldApproved = Device::forceCreate(['token' => Device::newToken(), 'created_at' => now()->subDays(90), 'approved_at' => now()->subDays(89)]);

        $this->actingAs($this->admin())->get('/admin')->assertOk();
        $this->assertNull($stale->fresh());
        $this->assertNotNull($recent->fresh());
        $this->assertNotNull($oldApproved->fresh());
    }

    // ------------------------------------------------------------ users
    public function test_users_can_be_promoted_disabled_and_deleted_but_never_the_admin_themselves(): void
    {
        $admin = $this->admin();
        $player = User::factory()->create(['name' => 'Player']);
        Device::create(['token' => Device::newToken(), 'user_id' => $player->id]);

        $this->actingAs($admin)->get('/admin')->assertInertia(fn (Assert $page) => $page
            ->has('users', 2)
            ->where('users.0.name', 'Boss')->where('users.0.is_admin', true)
            ->where('users.1.name', 'Player')->where('users.1.is_admin', false)->where('users.1.devices_count', 1));

        $this->actingAs($admin)->post("/admin/users/{$player->id}/toggle-admin")->assertRedirect();
        $this->assertTrue($player->fresh()->is_admin);
        $this->actingAs($admin)->post("/admin/users/{$player->id}/toggle-admin");
        $this->assertFalse($player->fresh()->is_admin);

        $this->actingAs($admin)->post("/admin/users/{$player->id}/toggle-disabled");
        $this->assertTrue($player->fresh()->is_disabled);

        $this->actingAs($admin)->post("/admin/users/{$admin->id}/toggle-admin")->assertSessionHasErrors('user');
        $this->actingAs($admin)->post("/admin/users/{$admin->id}/toggle-disabled")->assertSessionHasErrors('user');
        $this->actingAs($admin)->delete("/admin/users/{$admin->id}")->assertSessionHasErrors('user');
        $this->assertTrue($admin->fresh()->isAdmin());

        $this->actingAs($admin)->delete("/admin/users/{$player->id}")->assertRedirect();
        $this->assertNull($player->fresh());
        $this->assertSame(0, Device::count()); // cascaded
    }

    public function test_the_env_admin_cannot_be_demoted_from_the_ui(): void
    {
        config(['admin.email' => 'root@example.com']);
        $admin = $this->admin();
        $root = User::factory()->create(['email' => 'root@example.com', 'name' => 'Root']);
        $this->actingAs($admin)->post("/admin/users/{$root->id}/toggle-admin")->assertSessionHasErrors('user');
        $this->actingAs($admin)->post("/admin/users/{$root->id}/toggle-disabled")->assertSessionHasErrors('user');
        $this->actingAs($admin)->delete("/admin/users/{$root->id}")->assertSessionHasErrors('user');
        $this->assertFalse($root->fresh()->is_disabled);
        $this->actingAs($admin)->get('/admin')->assertInertia(fn (Assert $page) => $page
            ->where('users.1.is_admin', true)->where('users.1.is_env_admin', true));
    }

    // ------------------------------------------------------------ rooms
    public function test_a_live_room_can_be_force_closed_with_its_signals(): void
    {
        $admin = $this->admin();
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'p', 'host_name' => 'Teddy', 'expires_at' => now()->addHour()]);
        Room::create(['code' => 'OLDOLD', 'host_peer_id' => 'q', 'host_name' => 'Gone', 'expires_at' => now()->subHour()]);
        RoomSignal::create(['room_code' => 'ABCDEF', 'from_peer' => 'a', 'to_peer' => 'b', 'type' => 'offer', 'data' => ['x' => 1]]);

        $this->actingAs($admin)->get('/admin')->assertInertia(fn (Assert $page) => $page->has('rooms', 1)->where('rooms.0.code', 'ABCDEF'));

        $this->actingAs($admin)->delete('/admin/rooms/abcdef')->assertRedirect()->assertSessionHas('status', 'Room ABCDEF closed.');
        $this->assertSame(0, Room::query()->where('code', 'ABCDEF')->count());
        $this->assertSame(0, RoomSignal::count());
    }

    // ------------------------------------------------------------ console
    public function test_admin_sync_creates_or_promotes_the_env_admin(): void
    {
        config(['admin.email' => '', 'admin.password' => '']);
        $this->artisan('admin:sync')->expectsOutputToContain('ADMIN_EMAIL is not set')->assertSuccessful();
        $this->assertSame(0, User::count());

        config(['admin.email' => 'root@example.com', 'admin.password' => '']);
        $this->artisan('admin:sync')->assertFailed();

        User::factory()->create(['name' => 'Admin']); // the default name is taken
        config(['admin.email' => 'root@example.com', 'admin.password' => 'top-secret-1', 'admin.name' => 'Admin']);
        $this->artisan('admin:sync')->assertSuccessful();
        $root = User::query()->where('email', 'root@example.com')->sole();
        $this->assertTrue($root->is_admin);
        $this->assertSame('Admin 2', $root->name);
        $this->assertTrue(password_verify('top-secret-1', $root->password));

        // re-running is idempotent: same row, password rotated from .env
        config(['admin.password' => 'new-secret-22']);
        $this->artisan('admin:sync')->assertSuccessful();
        $this->assertSame(2, User::count());
        $this->assertTrue(password_verify('new-secret-22', $root->fresh()->password));
    }

    public function test_make_admin_promotes_an_existing_user_and_approves_their_devices(): void
    {
        $user = User::factory()->disabled()->create(['email' => 'teddy@example.com']);
        $device = Device::create(['token' => Device::newToken(), 'user_id' => $user->id]);

        $this->artisan('user:make-admin', ['email' => 'nobody@example.com'])->assertFailed();
        $this->artisan('user:make-admin', ['email' => 'teddy@example.com'])->assertSuccessful();
        $this->assertTrue($user->fresh()->is_admin);
        $this->assertFalse($user->fresh()->is_disabled);
        $this->assertNotNull($device->fresh()->approved_at);
    }
}
