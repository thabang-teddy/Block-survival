<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\GameHost;
use App\Models\GlobalSeat;
use App\Models\Room;
use App\Models\Score;
use App\Models\User;
use App\Models\World;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * A host PC (docs/pc-host-research.md): each host key runs one global world. The world
 * is open while its PC is online, waits while the PC is paused, and is closed — nobody
 * can enter, no browser takes over — once the PC shut down cleanly or was marked offline.
 */
class PcHostTest extends TestCase
{
    use RefreshDatabase;

    private const PEER = 'pcPEERpcPEER0001';

    private GameHost $pc;

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        [$this->pc, $this->token] = GameHost::register('HomePC');
    }

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

    private function host(string $method, string $uri, array $data = [], ?string $token = null)
    {
        return $this->withToken($token ?? $this->token)->json($method, $uri, $data);
    }

    /** @param list<int> $userIds */
    private function heartbeat(array $userIds = [], string $code = 'PCPCPC', array $extra = [], ?string $token = null, string $peer = self::PEER)
    {
        return $this->host('POST', '/api/host/heartbeat', [
            'version' => '0.2.0', 'peer_id' => $peer,
            'room' => ['code' => $code, 'players' => count($userIds), 'user_ids' => $userIds],
            ...$extra,
        ], $token);
    }

    private function going(string $going, ?string $token = null)
    {
        return $this->host('POST', '/api/host/heartbeat', ['version' => '0.2.0', 'peer_id' => self::PEER, 'going' => $going], $token);
    }

    private function join(User $user, ?GameHost $pc = null)
    {
        return $this->actingAs($user)->postJson('/api/global/join', ['world' => ($pc ?? $this->pc)->id]);
    }

    // ------------------------------------------------------------ the token
    public function test_the_host_routes_take_the_host_token_and_nothing_else(): void
    {
        $this->postJson('/api/host/heartbeat')->assertUnauthorized();
        $this->withToken('nope')->postJson('/api/host/heartbeat')->assertUnauthorized();
        // a player's session does not open them either
        $this->signIn($this->player('Ana'))->postJson('/api/host/heartbeat')->assertUnauthorized();
        $this->app['auth']->forgetGuards();

        // and the host token opens nothing a player can reach
        $this->withToken($this->token)->getJson('/api/auth/me')->assertUnauthorized();
        $this->withToken($this->token)->postJson('/api/global/join')->assertUnauthorized();

        $this->pc->update(['enabled' => false]);
        $this->heartbeat()->assertUnauthorized();
    }

    public function test_the_heartbeat_is_validated(): void
    {
        $this->host('POST', '/api/host/heartbeat', ['version' => '1', 'peer_id' => 'short'])->assertUnprocessable();
        $this->host('POST', '/api/host/heartbeat', ['version' => '1', 'peer_id' => self::PEER])->assertUnprocessable();
        $this->heartbeat(code: 'ABCDEI')->assertUnprocessable();
        $this->heartbeat(extra: ['stats' => ['junk' => str_repeat('x', 5000)]])->assertStatus(413);
    }

    // ------------------------------------------------------------ online
    public function test_an_online_pc_runs_its_world_and_players_join_it_through_the_mailbox(): void
    {
        $ana = $this->player('Ana');
        $device = Device::query()->where('user_id', $ana->id)->first();
        $this->assertSame('offline', $this->pc->state());

        $this->heartbeat()->assertOk()
            ->assertJsonPath('state', 'online')
            ->assertJsonPath('room.code', 'PCPCPC')
            ->assertJsonPath('seed', GameHost::CLASSIC_SEED)
            ->assertJsonPath('rules.daySeconds', 900)
            ->assertJsonPath('commands', []);
        $this->assertSame('online', $this->pc->refresh()->state());

        $this->join($ana)->assertOk()
            ->assertJsonPath('status', 'client')->assertJsonPath('host', 'pc')->assertJsonPath('world', $this->pc->id)
            ->assertJsonPath('room.code', 'PCPCPC')->assertJsonPath('room.host_peer_id', self::PEER);
        // no browser may host or save a global world
        $this->actingAs($ana)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'world_kind' => 'global'])->assertStatus(409);
        $this->actingAs($ana)->call('PUT', '/api/world/global', [], $this->prepareCookiesForRequest(), [], ['CONTENT_TYPE' => 'application/gzip', 'HTTP_ACCEPT' => 'application/json'], gzencode('{}'))->assertNotFound();

        // the offer the PC reads says who posted it; what the client claims is not asked
        $this->actingAs($ana)->getJson('/api/rooms/PCPCPC')->assertOk();
        $this->actingAs($ana)->postJson('/api/rooms/PCPCPC/signal', ['from' => 'anaAAAAAAAAA', 'to' => self::PEER, 'type' => 'offer', 'data' => ['type' => 'offer', 'sdp' => "v=0\r\n"]])->assertCreated();
        $this->host('GET', '/api/host/signals?after=0')->assertOk()
            ->assertJsonCount(1, 'signals')
            ->assertJsonPath('signals.0.from', 'anaAAAAAAAAA')
            ->assertJsonPath('signals.0.type', 'offer')
            ->assertJsonPath('signals.0.data.sdp', "v=0\r\n")
            ->assertJsonPath('signals.0.from_user_id', $ana->id)
            ->assertJsonPath('signals.0.from_device_id', $device->id)
            ->assertJsonPath('signals.0.from_name', 'Ana');

        // the PC answers; the player reads it from its own mailbox
        $this->host('POST', '/api/host/signal', ['to' => 'anaAAAAAAAAA', 'type' => 'answer', 'data' => ['type' => 'answer', 'sdp' => 'v=0']])->assertCreated();
        $this->host('POST', '/api/host/signal', ['to' => 'anaAAAAAAAAA', 'type' => 'offer', 'data' => []])->assertUnprocessable();
        $this->actingAs($ana)->getJson('/api/rooms/PCPCPC/signals?to=anaAAAAAAAAA')->assertOk()
            ->assertJsonCount(1, 'signals')->assertJsonPath('signals.0.from', self::PEER);

        // the PC's heartbeat vouches for the players connected to it
        Carbon::setTestNow(now()->addSeconds(30));
        $this->heartbeat([$ana->id])->assertOk();
        Carbon::setTestNow(now()->addSeconds(30));
        $this->assertTrue(GlobalSeat::query()->where('user_id', $ana->id)->first()->isFresh());
    }

    public function test_a_room_code_someone_else_holds_is_refused(): void
    {
        $ana = $this->player('Ana');
        Room::create(['code' => 'PCPCPC', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'user_id' => $ana->id, 'expires_at' => now()->addHour()]);
        $this->heartbeat()->assertStatus(409);
        $this->heartbeat(code: 'QRSTUV')->assertOk()->assertJsonPath('room.code', 'QRSTUV');
    }

    // ------------------------------------------------------------ paused
    public function test_a_pc_that_goes_quiet_pauses_its_world_for_as_long_as_it_takes(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->heartbeat()->assertOk();
        $this->join($ana)->assertJsonPath('status', 'client');

        // the network cable is pulled: no heartbeat for more than 45 s
        Carbon::setTestNow(now()->addSeconds(GameHost::STALE_SECONDS + 1));
        $this->assertSame('paused', $this->pc->refresh()->state());
        $this->actingAs($ana)->postJson('/api/global/claim')->assertOk()
            ->assertJsonPath('status', 'paused')->assertJsonPath('host', 'pc')->assertJsonPath('host_name', 'HomePC');
        // a new arrival waits too
        $this->join($ben)->assertOk()->assertJsonPath('status', 'paused');
        // the paused PC's room is shut to joiners
        $this->actingAs($ana)->postJson('/api/rooms/PCPCPC/signal', ['from' => 'anaAAAAAAAAA', 'to' => self::PEER, 'type' => 'offer', 'data' => ['sdp' => 'v=0']])->assertForbidden();

        // hours later, with the players polling claim all along, it is still paused
        for ($i = 0; $i < 3; $i++) {
            Carbon::setTestNow(now()->addHours(1));
            $this->actingAs($ana)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'paused');
        }

        // the PC is back: everyone is sent to it
        $this->heartbeat()->assertOk()->assertJsonPath('state', 'online');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'client')->assertJsonPath('room.code', 'PCPCPC');
    }

    public function test_a_restart_pauses_at_once(): void
    {
        $ana = $this->player('Ana');
        $this->heartbeat()->assertOk();
        $this->join($ana);

        $this->going('restart')->assertOk()->assertJsonPath('state', 'paused');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'paused');

        // after the reboot the app has a new peer id and a new room code; the old room goes
        $this->heartbeat(code: 'WXYZAB', peer: 'pcPEERpcPEER0002')->assertOk()->assertJsonPath('state', 'online');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('room.code', 'WXYZAB')->assertJsonPath('room.host_peer_id', 'pcPEERpcPEER0002');
        $this->assertSame(['WXYZAB'], Room::query()->pluck('code')->all());
    }

    // ------------------------------------------------------------ offline
    public function test_a_clean_shutdown_closes_the_world_and_nobody_can_enter_until_the_pc_runs_again(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->heartbeat()->assertOk();
        $this->join($ana);

        $this->going('offline')->assertOk()->assertJsonPath('state', 'offline');
        $this->assertSame(0, Room::query()->count());
        $this->assertSame(0, GlobalSeat::query()->count());

        // Ana, who was inside, is sent back to the lobby; Ben cannot get in
        $this->actingAs($ana)->postJson('/api/global/claim')->assertNotFound();
        $this->join($ben)->assertStatus(409)->assertJsonPath('message', "This world is offline — its host PC isn't running.");
        // and no browser takes over
        $this->actingAs($ben)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'benBBBBBBBBB', 'host_name' => 'Ben', 'world_kind' => 'global'])->assertStatus(409);

        // the PC starts again: its world opens at once
        $this->heartbeat()->assertOk()->assertJsonPath('state', 'online');
        $this->join($ben)->assertOk()->assertJsonPath('status', 'client');
    }

    public function test_the_admin_marks_a_paused_world_offline_and_its_waiting_players_go_back_to_the_lobby(): void
    {
        $ana = $this->player('Ana');
        $this->heartbeat()->assertOk();
        $this->join($ana);
        Carbon::setTestNow(now()->addHours(3));
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'paused');

        $admin = User::factory()->admin()->create();
        $this->actingAs($admin)->post("/admin/pc-hosts/{$this->pc->id}/offline")->assertRedirect();
        $this->assertSame('offline', $this->pc->refresh()->state());
        $this->actingAs($ana)->postJson('/api/global/claim')->assertNotFound();
        $this->join($ana)->assertStatus(409);

        // a PC that was in fact still running opens it again on its next heartbeat
        $this->heartbeat()->assertOk()->assertJsonPath('state', 'online');
    }

    // ------------------------------------------------------------ many PCs
    public function test_each_key_runs_its_own_world_with_its_own_seed_save_and_seats(): void
    {
        [$attic, $atticToken] = GameHost::register('Attic', 12345);
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');

        $this->heartbeat()->assertOk()->assertJsonPath('seed', GameHost::CLASSIC_SEED);
        $this->heartbeat(code: 'ATATAT', token: $atticToken, peer: 'pcPEERatat000001')->assertOk()->assertJsonPath('seed', 12345);
        $this->join($ana)->assertJsonPath('room.code', 'PCPCPC');
        $this->join($ben, $attic)->assertJsonPath('room.code', 'ATATAT')->assertJsonPath('world', $attic->id);

        // each PC's mailbox holds only its own room's mail
        $this->actingAs($ana)->postJson('/api/rooms/PCPCPC/signal', ['from' => 'anaAAAAAAAAA', 'to' => self::PEER, 'type' => 'offer', 'data' => ['sdp' => 'v=0']])->assertCreated();
        $this->host('GET', '/api/host/signals?after=0', [], $atticToken)->assertJsonCount(0, 'signals');
        // a player seated in one world cannot reach the other's room
        $this->actingAs($ben)->postJson('/api/rooms/PCPCPC/signal', ['from' => 'benBBBBBBBBB', 'to' => self::PEER, 'type' => 'offer', 'data' => ['sdp' => 'v=0']])->assertForbidden();

        // each saves its own world
        $put = fn (string $token, string $body) => $this->withToken($token)->call('PUT', '/api/host/world?night=2', [], [], [], [
            'CONTENT_TYPE' => 'application/gzip', 'HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$token,
        ], $body);
        $put($this->token, gzencode('{"home":1}'))->assertOk();
        $put($atticToken, gzencode('{"attic":1}'))->assertOk();
        $this->assertSame(['home' => 1], json_decode(gzdecode($this->withToken($this->token)->get('/api/host/world')->getContent()), true));
        $this->assertSame(['attic' => 1], json_decode(gzdecode($this->withToken($atticToken)->get('/api/host/world')->getContent()), true));

        // one PC going offline leaves the other world running
        $this->going('offline', $atticToken)->assertOk();
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'client');
        $this->assertSame(['PCPCPC'], Room::query()->pluck('code')->all());
    }

    // ------------------------------------------------------------ save, scores, access
    public function test_the_pc_reads_and_writes_its_world_save(): void
    {
        $this->host('GET', '/api/host/world')->assertNotFound();
        $put = fn (string $body) => $this->withToken($this->token)->call('PUT', '/api/host/world?night=3&seconds=100', [], [], [], [
            'CONTENT_TYPE' => 'application/gzip', 'HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$this->token,
        ], $body);

        $put('not gzip')->assertUnprocessable();
        $put(gzencode(json_encode(['players' => ['1' => [], '2' => []]])))->assertOk()->assertJsonPath('world.night', 3)->assertJsonPath('world.players', 2);
        $this->assertSame(1, World::query()->whereNull('user_id')->where('game_host_id', $this->pc->id)->count());

        $res = $this->withToken($this->token)->get('/api/host/world')->assertOk()->assertHeader('X-Save-Night', '3');
        $this->assertSame(['players' => ['1' => [], '2' => []]], json_decode(gzdecode($res->getContent()), true));

        // a PC shutting down saves after it went quiet or offline: that save is kept
        $this->going('offline')->assertOk();
        $put(gzencode('{}'))->assertOk();
        $this->assertSame(1, World::query()->whereNull('user_id')->count());
    }

    public function test_the_pc_records_runs_scored_by_the_site(): void
    {
        $ana = $this->player('Ana');
        $this->host('POST', '/api/host/scores', ['runs' => [
            ['user_id' => $ana->id, 'nights' => 2, 'kills' => 3, 'deaths' => 1, 'seconds' => 1800],
            ['user_id' => 9999, 'nights' => 1, 'kills' => 0, 'deaths' => 0, 'seconds' => 60],
        ]])->assertCreated()->assertJsonPath('recorded', 1);
        $this->assertSame(215, Score::query()->where('user_id', $ana->id)->value('score'));
        $this->host('POST', '/api/host/scores', ['runs' => [['user_id' => $ana->id, 'nights' => -1, 'kills' => 0, 'deaths' => 0, 'seconds' => 0]]])->assertUnprocessable();
    }

    public function test_the_pc_rechecks_access_for_everyone_connected(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $cat = $this->player('Cat');
        $anaDevice = Device::query()->where('user_id', $ana->id)->value('id');
        $benDevice = Device::query()->where('user_id', $ben->id)->first();
        $benDevice->update(['approved_at' => null]);
        $cat->update(['is_disabled' => true]);

        $this->host('POST', '/api/host/access', ['players' => [
            ['user_id' => $ana->id, 'device_id' => $anaDevice],
            ['user_id' => $ben->id, 'device_id' => $benDevice->id],
            ['user_id' => $cat->id, 'device_id' => null],
            ['user_id' => 9999, 'device_id' => null],
        ]])->assertOk()
            ->assertJsonPath('results.0.reason', null)
            ->assertJsonPath('results.1.reason', 'This PC is waiting for admin approval.')
            ->assertJsonPath('results.2.reason', 'This account has been disabled.')
            ->assertJsonPath('results.3.reason', 'This account no longer exists.');
    }

    // ------------------------------------------------------------ reset
    public function test_resetting_a_world_its_pc_runs_tells_the_pc(): void
    {
        $ana = $this->player('Ana');
        $this->heartbeat()->assertOk();
        World::put(null, World::GLOBAL, gzencode('{}'), [], $this->pc);
        $admin = User::factory()->admin()->create();

        $this->join($ana);
        $this->actingAs($admin)->delete("/admin/pc-hosts/{$this->pc->id}/world")->assertSessionHas('status', 'Someone is in this world — reset it when it is empty.');
        $this->actingAs($ana)->postJson('/api/global/leave');

        $this->actingAs($admin)->delete("/admin/pc-hosts/{$this->pc->id}/world")->assertSessionHas('status', "HomePC's world was reset.");
        $this->assertNull(World::global($this->pc));
        $this->heartbeat()->assertOk()->assertJsonPath('commands', ['reset']);
        $this->heartbeat()->assertOk()->assertJsonPath('commands', []);
    }

    // ------------------------------------------------------------ ICE servers
    public function test_ice_servers_are_stun_only_without_a_turn_key(): void
    {
        Http::fake();
        $this->signIn($this->player('Ana'))->getJson('/api/ice-servers')->assertOk()
            ->assertJsonPath('ice_servers.0.urls.0', 'stun:stun.l.google.com:19302');
        Http::assertNothingSent();
    }

    public function test_ice_servers_carry_cloudflare_turn_credentials_without_port_53(): void
    {
        config(['services.cloudflare_turn.key_id' => 'key123', 'services.cloudflare_turn.api_token' => 'secret']);
        Http::fake(['rtc.live.cloudflare.com/*' => Http::response(['iceServers' => [
            ['urls' => ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53']],
            ['urls' => ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], 'username' => 'u', 'credential' => 'c'],
        ]], 201)]);

        $this->signIn($this->player('Ana'))->getJson('/api/ice-servers')->assertOk()
            ->assertJsonPath('ice_servers.0.urls', ['stun:stun.cloudflare.com:3478'])
            ->assertJsonPath('ice_servers.1.urls', ['turn:turn.cloudflare.com:3478?transport=udp'])
            ->assertJsonPath('ice_servers.1.username', 'u');
        // cached: the PC's call does not mint another set
        $this->host('GET', '/api/host/ice-servers')->assertOk()->assertJsonPath('ice_servers.1.credential', 'c');
        Http::assertSentCount(1);
        Http::assertSent(fn ($req) => $req->url() === 'https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers'
            && $req->hasHeader('Authorization', 'Bearer secret') && $req['ttl'] === 7200);
    }

    public function test_ice_servers_fall_back_to_stun_when_cloudflare_fails(): void
    {
        config(['services.cloudflare_turn.key_id' => 'key123', 'services.cloudflare_turn.api_token' => 'secret']);
        Cache::flush();
        Http::fake(['rtc.live.cloudflare.com/*' => Http::response(['error' => 'nope'], 500)]);
        $this->signIn($this->player('Ana'))->getJson('/api/ice-servers')->assertOk()
            ->assertJsonPath('ice_servers.0.urls.0', 'stun:stun.l.google.com:19302');
    }
}
