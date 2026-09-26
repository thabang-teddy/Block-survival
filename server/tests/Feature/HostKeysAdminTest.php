<?php

namespace Tests\Feature;

use App\Models\GameHost;
use App\Models\GlobalSeat;
use App\Models\Room;
use App\Models\User;
use App\Models\World;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** The admin's list of host keys: one per global world, each run by a PC. */
class HostKeysAdminTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->admin()->create();
    }

    private function heartbeat(string $token, string $code = 'PCPCPC')
    {
        $res = $this->withToken($token)->postJson('/api/host/heartbeat', [
            'version' => '0.2.0', 'peer_id' => 'peer'.$code.'000000', 'room' => ['code' => $code, 'players' => 0],
        ]);
        $this->app['auth']->forgetGuards();

        return $res;
    }

    public function test_only_admins_see_or_change_the_keys(): void
    {
        [$pc] = GameHost::register('HomePC');
        $player = User::factory()->create();
        $this->signIn($player)->get('/admin/pc-hosts')->assertForbidden();
        $this->actingAs($player)->post('/admin/pc-hosts', ['name' => 'X'])->assertForbidden();
        $this->actingAs($player)->delete("/admin/pc-hosts/{$pc->id}")->assertForbidden();
        $this->assertSame(1, GameHost::query()->count());
    }

    public function test_the_list_shows_every_key_without_its_token(): void
    {
        [$home, $token] = GameHost::register('HomePC');
        [$attic] = GameHost::register('Attic', 42);
        $this->heartbeat($token);
        World::put(null, World::GLOBAL, gzencode('{}'), ['night' => 2], $home);

        $this->actingAs($this->admin())->get('/admin/pc-hosts')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Hosts')
            ->has('hosts', 2)
            ->where('hosts.0.name', 'HomePC')
            ->where('hosts.0.state', 'online')
            ->where('hosts.0.version', '0.2.0')
            ->where('hosts.0.seed', GameHost::CLASSIC_SEED)
            ->where('hosts.0.fingerprint', substr(GameHost::hashToken($token), 0, 8))
            ->where('hosts.0.save.night', 2)
            ->where('hosts.1.name', 'Attic')
            ->where('hosts.1.state', 'offline')
            ->where('hosts.1.seed', 42)
            ->where('hosts.1.save', null)
            ->missing('hosts.0.token_hash')
            ->has('hosts.0.created_at'));
    }

    public function test_creating_keys_shows_each_token_once_and_the_first_adopts_the_old_global_save(): void
    {
        World::create(['user_id' => null, 'kind' => World::GLOBAL, 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 9]);
        $admin = $this->admin();

        $this->actingAs($admin)->post('/admin/pc-hosts', ['name' => 'HomePC'])->assertRedirect()->assertSessionHas('host_token');
        $token = session('host_token');
        $home = GameHost::findByToken($token);
        $this->assertSame('HomePC', $home->name);
        $this->assertSame(GameHost::CLASSIC_SEED, $home->seed);
        $this->assertSame(9, World::global($home)->night);

        $this->actingAs($admin)->post('/admin/pc-hosts', ['name' => 'Attic', 'seed' => 5150])->assertSessionHas('host_token');
        $attic = GameHost::query()->where('name', 'Attic')->first();
        $this->assertSame(5150, $attic->seed);
        $this->assertNull(World::global($attic));
        $this->actingAs($admin)->post('/admin/pc-hosts', ['name' => 'Shed'])->assertSessionHas('host_token');
        $this->assertNotSame(GameHost::CLASSIC_SEED, GameHost::query()->where('name', 'Shed')->value('seed'));

        $this->actingAs($admin)->post('/admin/pc-hosts', ['name' => str_repeat('x', 17)])->assertSessionHasErrors('name');
        $this->actingAs($admin)->post('/admin/pc-hosts', ['name' => 'Bad', 'seed' => 0])->assertSessionHasErrors('seed');
        $this->assertSame(3, GameHost::query()->count());
    }

    public function test_rotating_a_token_stops_the_old_one(): void
    {
        [$pc, $old] = GameHost::register('HomePC');
        $this->actingAs($this->admin())->post("/admin/pc-hosts/{$pc->id}/token")->assertSessionHas('host_token');
        $new = session('host_token');

        $this->heartbeat($old)->assertUnauthorized();
        $this->heartbeat($new)->assertOk();
    }

    public function test_disabling_a_key_closes_its_world_and_refuses_its_pc_until_enabled(): void
    {
        [$pc, $token] = GameHost::register('HomePC');
        $this->heartbeat($token)->assertOk();
        $ana = User::factory()->create();
        $this->signIn($ana)->postJson('/api/global/join', ['world' => $pc->id])->assertOk();
        $admin = $this->admin();

        $this->actingAs($admin)->patch("/admin/pc-hosts/{$pc->id}", ['enabled' => false])->assertRedirect();
        $this->assertFalse($pc->refresh()->enabled);
        $this->assertSame(0, Room::query()->count());
        $this->assertSame(0, GlobalSeat::query()->count());
        $this->heartbeat($token)->assertUnauthorized();

        $this->actingAs($admin)->patch("/admin/pc-hosts/{$pc->id}", ['enabled' => true, 'name' => 'Renamed'])->assertRedirect();
        $this->heartbeat($token)->assertOk()->assertJsonPath('state', 'online')->assertJsonPath('room.host_name', 'Renamed');
    }

    public function test_removing_a_key_revokes_it_and_deletes_its_world(): void
    {
        [$home, $token] = GameHost::register('HomePC');
        [$attic] = GameHost::register('Attic');
        $this->heartbeat($token)->assertOk();
        World::put(null, World::GLOBAL, gzencode('{}'), [], $home);
        World::put(null, World::GLOBAL, gzencode('{}'), [], $attic);

        $this->actingAs($this->admin())->delete("/admin/pc-hosts/{$home->id}")->assertRedirect();
        $this->assertNull($home->fresh());
        $this->assertSame(0, Room::query()->count());
        $this->assertSame([$attic->id], World::query()->pluck('game_host_id')->all());
        $this->heartbeat($token)->assertUnauthorized();
    }

    public function test_the_dashboard_lists_the_worlds(): void
    {
        [, $token] = GameHost::register('HomePC');
        $this->heartbeat($token);

        $this->actingAs($this->admin())->get('/admin')->assertInertia(fn (Assert $page) => $page
            ->where('hostKeys', 1)
            ->where('globalWorlds.0.name', 'HomePC')
            ->where('globalWorlds.0.state', 'online')
            ->missing('pcHost'));
    }
}
