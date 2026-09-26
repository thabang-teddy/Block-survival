<?php

namespace Tests\Feature;

use App\Models\GameHost;
use App\Models\GlobalSeat;
use App\Models\User;
use App\Models\World;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/**
 * The global worlds from the players' side: one per host key, listed in the lobby, open
 * only while their PC runs them. A player sits in one world at a time.
 */
class GlobalWorldTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function player(string $name): User
    {
        $user = User::factory()->create(['name' => $name, 'email' => strtolower($name).'@example.com']);
        $this->device($user);

        return $user;
    }

    /** a key whose PC is online right now, with its room open */
    private function onlineWorld(string $name, string $code, ?int $seed = null): GameHost
    {
        [$pc, $token] = GameHost::register($name, $seed);
        $this->withToken($token)->postJson('/api/host/heartbeat', [
            'version' => '0.2.0', 'peer_id' => 'peer'.$code.'000000',
            'room' => ['code' => $code, 'players' => 0],
        ])->assertOk();
        $this->app['auth']->forgetGuards();

        return $pc->refresh();
    }

    public function test_the_list_shows_every_enabled_world_with_its_state_and_who_is_in_it(): void
    {
        $home = $this->onlineWorld('HomePC', 'HMHMHM');
        [$attic] = GameHost::register('Attic', 777);
        [$old] = GameHost::register('Old');
        $old->update(['enabled' => false]);
        World::put(null, World::GLOBAL, gzencode('{}'), ['night' => 4], $home);
        $ana = $this->player('Ana');
        $this->actingAs($ana)->postJson('/api/global/join', ['world' => $home->id])->assertOk();

        $this->actingAs($ana)->getJson('/api/global/worlds')->assertOk()
            ->assertJsonCount(2, 'worlds')
            ->assertJsonPath('worlds.0.name', 'HomePC')
            ->assertJsonPath('worlds.0.state', 'online')
            ->assertJsonPath('worlds.0.online', 1)
            ->assertJsonPath('worlds.0.seed', GameHost::CLASSIC_SEED)
            ->assertJsonPath('worlds.0.save.night', 4)
            ->assertJsonPath('worlds.1.name', 'Attic')
            ->assertJsonPath('worlds.1.state', 'offline')
            ->assertJsonPath('worlds.1.seed', 777)
            ->assertJsonPath('worlds.1.save', null);
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/global/worlds')->assertUnauthorized();
    }

    public function test_the_lobby_gets_the_list_as_a_prop(): void
    {
        $this->onlineWorld('HomePC', 'HMHMHM');
        $this->actingAs($this->player('Ana'))->get('/')->assertInertia(fn (Assert $page) => $page
            ->where('globalWorlds.0.name', 'HomePC')
            ->where('globalWorlds.0.state', 'online')
            ->where('worlds.own', null)
            ->missing('worlds.global')
            ->missing('presence'));
    }

    public function test_an_offline_or_unknown_world_cannot_be_entered(): void
    {
        [$attic] = GameHost::register('Attic');
        $ana = $this->player('Ana');
        $this->actingAs($ana)->postJson('/api/global/join', ['world' => $attic->id])
            ->assertStatus(409)->assertJsonPath('message', "This world is offline — its host PC isn't running.");
        $this->actingAs($ana)->postJson('/api/global/join', ['world' => 999])->assertNotFound();
        $attic->update(['enabled' => false]);
        $this->actingAs($ana)->postJson('/api/global/join', ['world' => $attic->id])->assertNotFound();
        $this->actingAs($ana)->postJson('/api/global/join', ['world' => 'x'])->assertUnprocessable();
        $this->assertSame(0, GlobalSeat::query()->count());
    }

    public function test_a_world_is_full_at_four(): void
    {
        $home = $this->onlineWorld('HomePC', 'HMHMHM');
        foreach (['Ana', 'Ben', 'Cat', 'Dan'] as $name) {
            $this->actingAs($this->player($name))->postJson('/api/global/join', ['world' => $home->id])->assertOk();
        }
        $this->actingAs($this->player('Eve'))->postJson('/api/global/join', ['world' => $home->id])->assertStatus(409);

        // seats nobody vouched for are swept, which frees room
        Carbon::setTestNow(now()->addSeconds(GlobalSeat::STALE_SECONDS + 1));
        $this->actingAs(User::query()->where('name', 'Eve')->first())->postJson('/api/global/join', ['world' => $home->id])->assertOk();
    }

    public function test_a_player_sits_in_one_world_at_a_time(): void
    {
        $home = $this->onlineWorld('HomePC', 'HMHMHM');
        $attic = $this->onlineWorld('Attic', 'ATATAT');
        $ana = $this->player('Ana');

        $this->actingAs($ana)->postJson('/api/global/join', ['world' => $home->id])->assertJsonPath('room.code', 'HMHMHM');
        $this->actingAs($ana)->getJson('/api/rooms/HMHMHM')->assertOk();
        $this->actingAs($ana)->getJson('/api/rooms/ATATAT')->assertForbidden();

        $this->actingAs($ana)->postJson('/api/global/join', ['world' => $attic->id])->assertJsonPath('room.code', 'ATATAT');
        $this->assertSame([$attic->id], GlobalSeat::query()->pluck('game_host_id')->all());
        $this->actingAs($ana)->getJson('/api/rooms/HMHMHM')->assertForbidden();
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('world', $attic->id);
    }

    public function test_a_player_who_left_cannot_claim_and_leaving_is_idempotent(): void
    {
        $home = $this->onlineWorld('HomePC', 'HMHMHM');
        $ana = $this->player('Ana');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertNotFound();
        $this->actingAs($ana)->postJson('/api/global/join', ['world' => $home->id])->assertOk();
        $this->actingAs($ana)->postJson('/api/global/leave')->assertOk();
        $this->actingAs($ana)->postJson('/api/global/leave')->assertOk();
        $this->actingAs($ana)->postJson('/api/global/claim')->assertNotFound();
    }

    public function test_clients_from_before_many_worlds_enter_the_first_open_one(): void
    {
        [$first] = GameHost::register('Offline');
        $home = $this->onlineWorld('HomePC', 'HMHMHM');
        $ana = $this->player('Ana');

        $this->actingAs($ana)->getJson('/api/global/presence')->assertOk()
            ->assertExactJson(['online' => 0, 'host_name' => 'HomePC', 'paused' => false]);
        $this->actingAs($ana)->postJson('/api/global/join')->assertOk()->assertJsonPath('world', $home->id);

        // no world at all: nothing to enter
        GameHost::query()->delete();
        $this->actingAs($ana)->getJson('/api/global/presence')->assertExactJson(['online' => 0, 'host_name' => null, 'paused' => false]);
        $this->actingAs($ana)->postJson('/api/global/join')->assertNotFound();
    }

    public function test_browsers_neither_open_nor_save_nor_load_a_global_world(): void
    {
        $this->onlineWorld('HomePC', 'HMHMHM');
        $ana = $this->player('Ana');
        $this->actingAs($ana)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'world_kind' => 'global'])
            ->assertStatus(409)->assertJsonPath('message', 'Global worlds are hosted by host PCs only.');
        $this->actingAs($ana)->getJson('/api/world/global')->assertNotFound();
        // nor refresh or close a PC's room with its peer id
        $this->actingAs($ana)->patchJson('/api/rooms/HMHMHM', ['host_peer_id' => 'peerHMHMHM000000', 'players' => 1])->assertNotFound();
        $this->actingAs($ana)->deleteJson('/api/rooms/HMHMHM', ['host_peer_id' => 'peerHMHMHM000000'])->assertOk();
        $this->actingAs($ana)->getJson('/api/rooms/HMHMHM')->assertForbidden();
    }
}
