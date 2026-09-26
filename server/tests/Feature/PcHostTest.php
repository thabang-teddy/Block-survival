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
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/**
 * The host PC (docs/pc-host-research.md): it holds the global world while it is online,
 * the world pauses while it is away, and the browser queue takes over only once it was
 * shut down cleanly or released — and gives the world back when the browsers are done.
 */
class PcHostTest extends TestCase
{
    use RefreshDatabase;

    private const PEER = 'pcPEERpcPEER0001';

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        [, $this->token] = GameHost::register('HomePC');
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

    private function host(string $method, string $uri, array $data = [])
    {
        return $this->withToken($this->token)->json($method, $uri, $data);
    }

    /** @param list<int> $userIds */
    private function heartbeat(array $userIds = [], string $code = 'PCPCPC', array $extra = [])
    {
        return $this->host('POST', '/api/host/heartbeat', [
            'version' => '0.1.0', 'peer_id' => self::PEER,
            'room' => ['code' => $code, 'players' => count($userIds), 'user_ids' => $userIds],
            ...$extra,
        ]);
    }

    private function pc(): GameHost
    {
        return GameHost::current()->refresh();
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

        GameHost::current()->update(['enabled' => false]);
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
    public function test_an_online_pc_hosts_the_global_world_and_players_join_it_through_the_mailbox(): void
    {
        $ana = $this->player('Ana');
        $device = Device::query()->where('user_id', $ana->id)->first();
        $this->assertSame('offline', GameHost::current()->state());

        $this->heartbeat()->assertOk()
            ->assertJsonPath('state', 'online')
            ->assertJsonPath('room.code', 'PCPCPC')
            ->assertJsonPath('rules.daySeconds', 900)
            ->assertJsonPath('commands', []);
        $this->assertSame('online', $this->pc()->state());

        // a player entering is sent to the PC, whichever seat they hold
        $this->actingAs($ana)->postJson('/api/global/join')->assertOk()
            ->assertJsonPath('status', 'client')->assertJsonPath('host', 'pc')
            ->assertJsonPath('room.code', 'PCPCPC')->assertJsonPath('room.host_peer_id', self::PEER);
        $this->actingAs($ana)->getJson('/api/global/presence')->assertOk()
            ->assertExactJson(['online' => 1, 'host_name' => 'HomePC', 'paused' => false]);
        // no browser may host or save it meanwhile
        $this->actingAs($ana)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'world_kind' => 'global'])->assertStatus(409);
        $this->actingAs($ana)->call('PUT', '/api/world/global', [], $this->prepareCookiesForRequest(), [], ['CONTENT_TYPE' => 'application/gzip', 'HTTP_ACCEPT' => 'application/json'], gzencode('{}'))->assertStatus(409);

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

    public function test_a_pc_coming_online_closes_a_browser_room_left_over_from_before(): void
    {
        $ana = $this->player('Ana');
        $this->actingAs($ana)->postJson('/api/global/join')->assertJsonPath('status', 'host')->assertJsonPath('host', 'browser');
        $this->actingAs($ana)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'world_kind' => 'global'])->assertCreated();
        $this->assertSame(1, Room::query()->count());

        // the PC was never registered before, so nothing is standing by: it takes the world
        GameHost::current()->update(['offline_at' => null]);
        $this->heartbeat()->assertOk()->assertJsonPath('state', 'online');
        $this->assertSame(['PCPCPC'], Room::query()->pluck('code')->all());
        $this->actingAs($ana)->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'anaAAAAAAAAA', 'players' => 1])->assertNotFound();
        $this->actingAs($ana)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'client')->assertJsonPath('host', 'pc');
    }

    public function test_a_room_code_someone_else_holds_is_refused(): void
    {
        $ana = $this->player('Ana');
        Room::create(['code' => 'PCPCPC', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'user_id' => $ana->id, 'expires_at' => now()->addHour()]);
        $this->heartbeat()->assertStatus(409);
        $this->heartbeat(code: 'QRSTUV')->assertOk()->assertJsonPath('room.code', 'QRSTUV');
    }

    // ------------------------------------------------------------ paused
    public function test_a_pc_that_goes_quiet_pauses_the_world_for_as_long_as_it_takes(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->heartbeat()->assertOk();
        $this->actingAs($ana)->postJson('/api/global/join')->assertJsonPath('status', 'client');

        // the network cable is pulled: no heartbeat for more than 45 s
        Carbon::setTestNow(now()->addSeconds(GameHost::STALE_SECONDS + 1));
        $this->assertSame('paused', $this->pc()->state());
        $this->actingAs($ana)->postJson('/api/global/claim')->assertOk()
            ->assertJsonPath('status', 'paused')->assertJsonPath('host', 'pc')->assertJsonPath('host_name', 'HomePC');
        // a new arrival waits too; nobody becomes a browser host
        $this->actingAs($ben)->postJson('/api/global/join')->assertOk()->assertJsonPath('status', 'paused');
        $this->actingAs($ben)->getJson('/api/global/presence')->assertJsonPath('paused', true);
        $this->actingAs($ben)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'benBBBBBBBBB', 'host_name' => 'Ben', 'world_kind' => 'global'])->assertStatus(409);
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
        $this->actingAs($ana)->postJson('/api/global/join');

        $this->host('POST', '/api/host/heartbeat', ['version' => '0.1.0', 'peer_id' => self::PEER, 'going' => 'restart'])
            ->assertOk()->assertJsonPath('state', 'paused');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'paused');

        // after the reboot the app has a new peer id and a new room code
        $this->host('POST', '/api/host/heartbeat', ['version' => '0.1.0', 'peer_id' => 'pcPEERpcPEER0002', 'room' => ['code' => 'WXYZAB', 'players' => 0]])
            ->assertOk()->assertJsonPath('state', 'online');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('room.code', 'WXYZAB')->assertJsonPath('room.host_peer_id', 'pcPEERpcPEER0002');
        $this->assertSame(['WXYZAB'], Room::query()->pluck('code')->all());
    }

    // ------------------------------------------------------------ offline, standby and taking the world back
    public function test_a_clean_shutdown_hands_the_world_to_the_browsers_and_the_pc_takes_it_back_when_their_room_closes(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->heartbeat()->assertOk();
        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($ben)->postJson('/api/global/join');

        $this->host('POST', '/api/host/heartbeat', ['version' => '0.1.0', 'peer_id' => self::PEER, 'going' => 'offline'])
            ->assertOk()->assertJsonPath('state', 'offline');
        $this->assertSame(0, Room::query()->count());

        // the browser queue takes over: Ana was first
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'host')->assertJsonPath('host', 'browser');
        $this->actingAs($ana)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'world_kind' => 'global'])->assertCreated();
        $this->actingAs($ben)->postJson('/api/global/claim')->assertJsonPath('status', 'client')->assertJsonPath('room.code', 'ABCDEF');

        // the PC starts again while they play: it does not interrupt them
        $this->heartbeat()->assertOk()->assertJsonPath('state', 'standby');
        $this->assertTrue($this->pc()->isStandingBy());
        $this->actingAs($ben)->postJson('/api/global/claim')->assertJsonPath('room.code', 'ABCDEF');
        $this->actingAs($ana)->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'anaAAAAAAAAA', 'players' => 2, 'user_ids' => [$ben->id]])->assertOk();

        // Ana leaves: her room closes and the PC takes the world back, with her last save
        $this->actingAs($ana)->deleteJson('/api/rooms/ABCDEF', ['host_peer_id' => 'anaAAAAAAAAA'])->assertOk();
        $this->actingAs($ben)->postJson('/api/global/claim')->assertJsonPath('status', 'paused');
        $this->heartbeat([$ben->id])->assertOk()->assertJsonPath('state', 'online');
        $this->actingAs($ben)->postJson('/api/global/claim')->assertJsonPath('status', 'client')->assertJsonPath('host', 'pc');
    }

    public function test_the_admin_release_hands_a_paused_world_to_the_browsers(): void
    {
        $ana = $this->player('Ana');
        $this->heartbeat()->assertOk();
        $this->actingAs($ana)->postJson('/api/global/join');
        Carbon::setTestNow(now()->addHours(3));
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'paused');

        $admin = User::factory()->admin()->create();
        $this->actingAs($admin)->post('/admin/pc-host/release')->assertRedirect();
        $this->assertSame('offline', $this->pc()->state());
        $this->actingAs($ana)->postJson('/api/global/claim')->assertJsonPath('status', 'host')->assertJsonPath('host', 'browser');

        // a PC that comes back while nobody is in the world takes it straight back
        $this->actingAs($ana)->postJson('/api/global/leave')->assertOk();
        $this->heartbeat()->assertOk()->assertJsonPath('state', 'online');
    }

    public function test_a_browser_host_that_dies_while_the_pc_stands_by_gives_the_world_to_the_pc(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->host('POST', '/api/host/heartbeat', ['version' => '0.1.0', 'peer_id' => self::PEER, 'going' => 'offline']);
        $this->actingAs($ana)->postJson('/api/global/join')->assertJsonPath('status', 'host');
        $this->actingAs($ana)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'anaAAAAAAAAA', 'host_name' => 'Ana', 'world_kind' => 'global'])->assertCreated();
        $this->actingAs($ben)->postJson('/api/global/join')->assertJsonPath('status', 'client');
        $this->heartbeat()->assertJsonPath('state', 'standby');

        // Ana's tab dies; the PC keeps beating, Ben keeps claiming
        Carbon::setTestNow(now()->addSeconds(30));
        $this->heartbeat()->assertJsonPath('state', 'standby');
        $this->actingAs($ben)->postJson('/api/global/claim');
        Carbon::setTestNow(now()->addSeconds(20));
        $this->heartbeat()->assertJsonPath('state', 'standby');
        $this->actingAs($ben)->postJson('/api/global/claim')->assertJsonPath('status', 'paused')->assertJsonPath('host', 'pc');
        $this->heartbeat([$ben->id])->assertJsonPath('state', 'online');
    }

    // ------------------------------------------------------------ save, scores, access
    public function test_the_pc_reads_and_writes_the_global_save_only_while_it_holds_the_world(): void
    {
        $this->host('GET', '/api/host/world')->assertNotFound();
        $put = fn (string $body) => $this->withToken($this->token)->call('PUT', '/api/host/world?night=3&seconds=100', [], [], [], [
            'CONTENT_TYPE' => 'application/gzip', 'HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$this->token,
        ], $body);

        $put(gzencode('{}'))->assertStatus(409);
        $this->heartbeat()->assertOk();
        $put('not gzip')->assertUnprocessable();
        $put(gzencode(json_encode(['players' => ['1' => [], '2' => []]])))->assertOk()->assertJsonPath('world.night', 3)->assertJsonPath('world.players', 2);
        $this->assertSame(1, World::query()->whereNull('user_id')->where('kind', 'global')->count());

        $res = $this->withToken($this->token)->get('/api/host/world')->assertOk()->assertHeader('X-Save-Night', '3');
        $this->assertSame(['players' => ['1' => [], '2' => []]], json_decode(gzdecode($res->getContent()), true));

        // paused still holds the world: its shutdown save is kept
        Carbon::setTestNow(now()->addMinutes(5));
        $put(gzencode('{}'))->assertOk();
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
    public function test_resetting_the_global_world_while_the_pc_holds_it_tells_the_pc(): void
    {
        $ana = $this->player('Ana');
        $this->heartbeat()->assertOk();
        World::put(null, World::GLOBAL, gzencode('{}'), []);
        $admin = User::factory()->admin()->create();

        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($admin)->delete('/admin/global-world')->assertSessionHas('status', 'Someone is in the global world — reset it when it is empty.');
        $this->actingAs($ana)->postJson('/api/global/leave');

        $this->actingAs($admin)->delete('/admin/global-world')->assertSessionHas('status', 'The global world was reset.');
        $this->assertNull(World::global());
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

    // ------------------------------------------------------------ admin
    public function test_the_admin_creates_rotates_and_revokes_the_host_token(): void
    {
        GameHost::query()->delete();
        $admin = User::factory()->admin()->create();
        $this->signIn($this->player('Ana'))->post('/admin/pc-host', ['name' => 'HomePC'])->assertForbidden();

        $this->actingAs($admin)->get('/admin')->assertInertia(fn (Assert $page) => $page->where('pcHost', null));
        $this->actingAs($admin)->post('/admin/pc-host', ['name' => 'HomePC'])->assertRedirect()->assertSessionHas('host_token');
        $first = session('host_token');
        $this->assertNotSame($first, GameHost::current()->token_hash);
        $this->assertSame(GameHost::hashToken($first), GameHost::current()->token_hash);
        $this->actingAs($admin)->post('/admin/pc-host', ['name' => 'Second'])->assertSessionMissing('host_token');
        $this->actingAs($admin)->get('/admin')->assertInertia(fn (Assert $page) => $page->where('pcHost.name', 'HomePC')->where('pcHost.state', 'offline')->missing('pcHost.token_hash'));

        $this->actingAs($admin)->post('/admin/pc-host/token')->assertSessionHas('host_token');
        $second = session('host_token');
        $this->withToken($first)->postJson('/api/host/heartbeat')->assertUnauthorized();
        $this->token = $second;
        $this->heartbeat()->assertOk();

        $this->actingAs($admin)->delete('/admin/pc-host')->assertRedirect();
        $this->assertNull(GameHost::current());
        $this->assertSame(0, Room::query()->count());
        $this->withToken($second)->postJson('/api/host/heartbeat')->assertUnauthorized();
    }
}
