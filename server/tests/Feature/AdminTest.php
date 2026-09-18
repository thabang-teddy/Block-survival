<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Room;
use App\Models\RoomSignal;
use App\Models\Setting;
use App\Models\User;
use App\Models\World;
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
        $player = User::factory()->create();
        foreach (['/admin', '/admin/hours', '/admin/devices', '/admin/users', '/admin/users/create', '/admin/rooms'] as $page) {
            $this->signIn($player)->get($page)->assertForbidden();
        }
        $this->signIn($player)->put('/admin/hours')->assertForbidden();
        $this->signIn($player)->post('/admin/users')->assertForbidden();

        $this->actingAs($this->admin())->get('/admin')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Dashboard')
            ->where('auth.user.is_admin', true)
            ->where('counts.users', 2)->where('counts.pendingDevices', 0)->where('counts.rooms', 0)
            ->where('windowOpen', true)
            ->where('pendingDevices', 0));
    }

    public function test_the_lobby_knows_whether_the_player_is_an_admin(): void
    {
        $this->signIn(User::factory()->create())->get('/')->assertInertia(fn (Assert $page) => $page->where('auth.user.is_admin', false));
        $this->actingAs($this->admin())->get('/')->assertInertia(fn (Assert $page) => $page->where('auth.user.is_admin', true));
    }

    // ------------------------------------------------------------ login window
    public function test_operating_hours_are_shown_saved_and_validated(): void
    {
        $admin = $this->admin();
        $this->actingAs($admin)->get('/admin/hours')->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Hours')->where('loginWindow.enabled', false)->has('timezones'));

        $this->actingAs($admin)->put('/admin/hours', [
            'enabled' => true, 'start' => '18:00', 'end' => '02:00', 'days' => [5, 6], 'timezone' => 'Africa/Johannesburg',
        ])->assertRedirect()->assertSessionHas('status', 'Operating hours saved.');

        $window = LoginWindow::fromSettings();
        $this->assertTrue($window->enabled);
        $this->assertSame(['18:00', '02:00', [5, 6], 'Africa/Johannesburg'], [$window->start, $window->end, $window->days, $window->timezone]);
        $this->assertSame('18:00', Setting::get('login_window_start'));

        $this->actingAs($admin)->put('/admin/hours', [
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

        $this->actingAs($admin)->get('/admin/devices')->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Devices')
            ->where('pendingDevices', 1)
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

    public function test_stale_pending_devices_are_swept_when_the_devices_page_opens(): void
    {
        $stale = Device::forceCreate(['token' => Device::newToken(), 'created_at' => now()->subDays(31)]);
        $recent = Device::forceCreate(['token' => Device::newToken(), 'created_at' => now()->subDays(29)]);
        $oldApproved = Device::forceCreate(['token' => Device::newToken(), 'created_at' => now()->subDays(90), 'approved_at' => now()->subDays(89)]);

        $this->actingAs($this->admin())->get('/admin/devices')->assertOk();
        $this->assertNull($stale->fresh());
        $this->assertNotNull($recent->fresh());
        $this->assertNotNull($oldApproved->fresh());
    }

    // ------------------------------------------------------------ users
    public function test_users_are_listed_with_their_world_and_devices(): void
    {
        $admin = $this->admin();
        $player = User::factory()->create(['name' => 'Player']);
        Device::create(['token' => Device::newToken(), 'user_id' => $player->id]);
        World::create(['user_id' => $player->id, 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 4, 'seconds' => 100]);

        $this->actingAs($admin)->get('/admin/users')->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Users')
            ->has('users', 2)
            ->where('users.0.name', 'Boss')->where('users.0.is_admin', true)->where('users.0.world', null)
            ->where('users.1.name', 'Player')->where('users.1.is_admin', false)
            ->where('users.1.devices_count', 1)->where('users.1.world.night', 4));
    }

    public function test_an_admin_creates_accounts_and_weak_passwords_are_fine(): void
    {
        $admin = $this->admin();
        $this->actingAs($admin)->get('/admin/users/create')->assertInertia(fn (Assert $page) => $page
            ->component('Admin/UserForm')->where('user', null));

        $this->actingAs($admin)->post('/admin/users', [
            'name' => 'Kid', 'email' => 'kid@example.com', 'password' => '1', 'is_admin' => false, 'is_disabled' => false,
        ])->assertRedirect('/admin/users')->assertSessionHas('status', 'Kid created.');
        $kid = User::query()->where('email', 'kid@example.com')->sole();
        $this->assertTrue(password_verify('1', $kid->password));
        $this->assertFalse($kid->isAdmin());

        $this->actingAs($admin)->post('/admin/users', [
            'name' => 'Kid', 'email' => 'kid@example.com', 'password' => '', 'is_admin' => 'maybe', 'is_disabled' => false,
        ])->assertSessionHasErrors(['name', 'email', 'password', 'is_admin']);
        $this->actingAs($admin)->post('/admin/users', [
            'name' => 'Bad<name>', 'email' => 'nope', 'password' => 'x', 'is_admin' => false, 'is_disabled' => false,
        ])->assertSessionHasErrors(['name', 'email']);
    }

    public function test_an_admin_edits_accounts_and_a_blank_password_keeps_the_old_one(): void
    {
        $admin = $this->admin();
        $player = User::factory()->create(['name' => 'Player', 'email' => 'p@example.com', 'password' => 'old-pass']);

        $this->actingAs($admin)->get("/admin/users/{$player->id}/edit")->assertInertia(fn (Assert $page) => $page
            ->component('Admin/UserForm')->where('user.id', $player->id)->where('user.email', 'p@example.com'));

        $this->actingAs($admin)->put("/admin/users/{$player->id}", [
            'name' => 'Renamed', 'email' => 'r@example.com', 'password' => '', 'is_admin' => true, 'is_disabled' => true,
        ])->assertRedirect('/admin/users')->assertSessionHas('status', 'Renamed saved.');
        $player->refresh();
        $this->assertSame(['Renamed', 'r@example.com', true, true], [$player->name, $player->email, $player->is_admin, $player->is_disabled]);
        $this->assertTrue(password_verify('old-pass', $player->password));

        $this->actingAs($admin)->put("/admin/users/{$player->id}", [
            'name' => 'Renamed', 'email' => 'r@example.com', 'password' => 'new', 'is_admin' => false, 'is_disabled' => false,
        ])->assertRedirect('/admin/users');
        $this->assertTrue(password_verify('new', $player->fresh()->password));
        $this->assertFalse($player->fresh()->is_admin);

        // names and emails stay unique across accounts, but a user may keep their own
        $this->actingAs($admin)->put("/admin/users/{$player->id}", [
            'name' => 'Boss', 'email' => 'boss@example.com', 'password' => '', 'is_admin' => false, 'is_disabled' => false,
        ])->assertSessionHasErrors(['name', 'email']);
    }

    public function test_an_admin_cannot_change_their_own_role_or_delete_themselves(): void
    {
        $admin = $this->admin();
        // renaming yourself is fine; flipping your own flags is not
        $this->actingAs($admin)->put("/admin/users/{$admin->id}", [
            'name' => 'Big Boss', 'email' => 'boss@example.com', 'password' => '', 'is_admin' => true, 'is_disabled' => false,
        ])->assertRedirect('/admin/users');
        $this->assertSame('Big Boss', $admin->fresh()->name);
        $this->actingAs($admin)->put("/admin/users/{$admin->id}", [
            'name' => 'Big Boss', 'email' => 'boss@example.com', 'password' => '', 'is_admin' => false, 'is_disabled' => false,
        ])->assertSessionHasErrors('user');
        $this->actingAs($admin)->put("/admin/users/{$admin->id}", [
            'name' => 'Big Boss', 'email' => 'boss@example.com', 'password' => '', 'is_admin' => true, 'is_disabled' => true,
        ])->assertSessionHasErrors('user');
        $this->actingAs($admin)->delete("/admin/users/{$admin->id}")->assertSessionHasErrors('user');
        $this->assertTrue($admin->fresh()->isAdmin());
    }

    public function test_deleting_a_user_takes_their_world_and_devices_along(): void
    {
        $admin = $this->admin();
        $player = User::factory()->create(['name' => 'Player']);
        Device::create(['token' => Device::newToken(), 'user_id' => $player->id]);
        World::create(['user_id' => $player->id, 'payload' => base64_encode(gzencode('{}')), 'size' => 22]);

        $this->actingAs($admin)->delete("/admin/users/{$player->id}")->assertRedirect('/admin/users')->assertSessionHas('status', 'Player deleted.');
        $this->assertNull($player->fresh());
        $this->assertSame(0, Device::count());
        $this->assertSame(0, World::count());
    }

    public function test_an_admin_can_reset_a_players_world(): void
    {
        $admin = $this->admin();
        $player = User::factory()->create(['name' => 'Player']);
        World::create(['user_id' => $player->id, 'payload' => base64_encode(gzencode('{}')), 'size' => 22]);
        World::create(['user_id' => null, 'kind' => 'global', 'payload' => base64_encode(gzencode('{}')), 'size' => 22]);

        // the shared global world is not theirs to lose
        $this->actingAs($admin)->delete("/admin/users/{$player->id}/world")->assertRedirect()->assertSessionHas('status', "Player's world was reset.");
        $this->assertSame(1, World::count());
        $this->assertNotNull(World::global());
        $this->actingAs($admin)->delete("/admin/users/{$player->id}/world")->assertRedirect(); // nothing to reset is fine
    }

    public function test_the_env_admin_can_only_be_changed_through_env(): void
    {
        config(['admin.email' => 'root@example.com']);
        $admin = $this->admin();
        $root = User::factory()->create(['email' => 'root@example.com', 'name' => 'Root']);

        $this->actingAs($admin)->put("/admin/users/{$root->id}", [
            'name' => 'Root', 'email' => 'root@example.com', 'password' => 'new', 'is_admin' => false, 'is_disabled' => false,
        ])->assertSessionHasErrors('user');
        $this->actingAs($admin)->put("/admin/users/{$root->id}", [
            'name' => 'Root', 'email' => 'moved@example.com', 'password' => '', 'is_admin' => true, 'is_disabled' => false,
        ])->assertSessionHasErrors('email');
        $this->actingAs($admin)->delete("/admin/users/{$root->id}")->assertSessionHasErrors('user');

        // a rename or password change is still allowed
        $this->actingAs($admin)->put("/admin/users/{$root->id}", [
            'name' => 'Rooty', 'email' => 'ROOT@example.com', 'password' => 'fresh', 'is_admin' => true, 'is_disabled' => false,
        ])->assertRedirect('/admin/users');
        $this->assertSame('Rooty', $root->fresh()->name);
        $this->assertTrue(password_verify('fresh', $root->fresh()->password));

        $this->actingAs($admin)->get('/admin/users')->assertInertia(fn (Assert $page) => $page
            ->where('users.1.is_admin', true)->where('users.1.is_env_admin', true));
    }

    // ------------------------------------------------------------ rooms
    public function test_a_live_room_can_be_force_closed_with_its_signals(): void
    {
        $admin = $this->admin();
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'p', 'host_name' => 'Teddy', 'expires_at' => now()->addHour()]);
        Room::create(['code' => 'OLDOLD', 'host_peer_id' => 'q', 'host_name' => 'Gone', 'expires_at' => now()->subHour()]);
        RoomSignal::create(['room_code' => 'ABCDEF', 'from_peer' => 'a', 'to_peer' => 'b', 'type' => 'offer', 'data' => ['x' => 1]]);

        $this->actingAs($admin)->get('/admin/rooms')->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Rooms')->has('rooms', 1)->where('rooms.0.code', 'ABCDEF')
            ->where('rooms.0.world_kind', 'own')->where('rooms.0.invites', 0));

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
