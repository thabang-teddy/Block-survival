<?php

namespace Tests\Feature;

use App\Models\GlobalSeat;
use App\Models\Room;
use App\Models\User;
use App\Models\World;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/**
 * The shared global world: one save, hosted by whoever is at the front of the queue of
 * players inside it; the next in line takes over when the host goes.
 */
class GlobalWorldTest extends TestCase
{
    use RefreshDatabase;

    /** a player whose browser an admin has approved */
    private function player(string $name): User
    {
        $user = User::factory()->create(['name' => $name, 'email' => strtolower($name).'@example.com']);
        $this->device($user);

        return $user;
    }

    /** the host's room, as HostSession.listen() registers it */
    private function openRoom(User $host, string $code = 'ABCDEF')
    {
        return $this->actingAs($host)->postJson('/api/rooms', [
            'code' => $code, 'host_peer_id' => "peer-$code", 'host_name' => $host->name, 'world_kind' => 'global',
        ]);
    }

    private function putGzip(User $user, string $uri, string $body)
    {
        return $this->actingAs($user)->call('PUT', $uri, [], $this->prepareCookiesForRequest(), [], [
            'CONTENT_TYPE' => 'application/gzip',
            'HTTP_ACCEPT' => 'application/json',
        ], $body);
    }

    // ------------------------------------------------------------ entering
    public function test_the_first_player_in_hosts_and_the_next_joins_their_room(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');

        $this->actingAs($ana)->postJson('/api/global/join')->assertOk()
            ->assertJsonPath('status', 'host')->assertJsonPath('online', 1);

        // Ana is chosen but has not opened her room yet: Ben waits
        $this->actingAs($ben)->postJson('/api/global/join')->assertOk()
            ->assertJsonPath('status', 'pending')->assertJsonPath('host_name', 'Ana')->assertJsonPath('online', 2);

        $this->openRoom($ana)->assertCreated();
        $this->assertSame('ABCDEF', GlobalSeat::query()->where('user_id', $ana->id)->value('room_code'));

        // asking again (or entering afresh) now hands out the room
        $this->actingAs($ben)->postJson('/api/global/claim')->assertOk()
            ->assertJsonPath('status', 'client')->assertJsonPath('room.code', 'ABCDEF')->assertJsonPath('room.world_kind', 'global');
        // and the room admits Ben without an invitation, mailbox included
        $this->actingAs($ben)->getJson('/api/rooms/ABCDEF')->assertOk()->assertJsonPath('room.host_peer_id', 'peer-ABCDEF');
        $this->actingAs($ben)->getJson('/api/rooms/ABCDEF/signals?to=peer-ABCDEF')->assertOk();
    }

    public function test_only_the_front_of_the_queue_may_open_the_global_room(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($ben)->postJson('/api/global/join');

        $this->openRoom($ben, 'BBBBBB')->assertStatus(409);
        // and someone who never entered cannot either, nor can they use its mailbox
        $carl = $this->player('Carl');
        $this->openRoom($carl, 'CCCCCC')->assertStatus(409);
        $this->openRoom($ana)->assertCreated();
        $this->actingAs($carl)->getJson('/api/rooms/ABCDEF')->assertForbidden();
        $this->actingAs($carl)->getJson('/api/rooms/ABCDEF/signals?to=peer-ABCDEF')->assertForbidden();
    }

    public function test_the_world_is_full_at_four_and_a_second_tab_of_the_host_is_refused(): void
    {
        $players = array_map(fn ($n) => $this->player($n), ['Ana', 'Ben', 'Carl', 'Dee']);
        foreach ($players as $p) {
            $this->actingAs($p)->postJson('/api/global/join')->assertOk();
        }
        $this->actingAs($this->player('Eve'))->postJson('/api/global/join')->assertStatus(409);
        // a player already inside may re-enter (they only lose their place)
        $this->actingAs($players[1])->postJson('/api/global/join')->assertOk();

        $this->openRoom($players[0])->assertCreated();
        $this->actingAs($players[0])->postJson('/api/global/join')->assertStatus(409);
    }

    // ------------------------------------------------------------ succession
    public function test_when_the_host_leaves_the_next_in_line_hosts_and_the_old_host_returns_last(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $carl = $this->player('Carl');
        foreach ([$ana, $ben, $carl] as $p) {
            $this->actingAs($p)->postJson('/api/global/join');
        }
        $this->openRoom($ana)->assertCreated();

        // Ana goes back to the menu: closing her room is leaving the world
        $this->actingAs($ana)->deleteJson('/api/rooms/ABCDEF', ['host_peer_id' => 'peer-ABCDEF'])->assertOk();
        $this->assertNull(GlobalSeat::query()->where('user_id', $ana->id)->first());

        $this->actingAs($ben)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'host');
        $this->actingAs($carl)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'pending')->assertJsonPath('host_name', 'Ben');
        $this->openRoom($ben, 'BBBBBB')->assertCreated();
        $this->actingAs($carl)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'client')->assertJsonPath('room.code', 'BBBBBB');

        // Ana comes back: behind Carl now
        $this->actingAs($ana)->postJson('/api/global/join')->assertOk()->assertJsonPath('status', 'client')->assertJsonPath('room.code', 'BBBBBB');
        $this->assertSame([$ben->id, $carl->id, $ana->id], GlobalSeat::query()->orderBy('id')->pluck('user_id')->all());
    }

    public function test_a_host_whose_tab_died_is_dropped_once_stale_and_its_room_goes_with_it(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($ben)->postJson('/api/global/join');
        $this->openRoom($ana)->assertCreated();

        // Ana's refresh vouches for Ben; nothing vouches for Ana after that
        $this->actingAs($ana)->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'peer-ABCDEF', 'players' => 2, 'user_ids' => [$ben->id]])->assertOk();
        Carbon::setTestNow(now()->addSeconds(GlobalSeat::STALE_SECONDS - 5));
        $this->actingAs($ben)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'client');

        Carbon::setTestNow(now()->addSeconds(10));
        $this->actingAs($ben)->postJson('/api/global/claim')->assertOk()->assertJsonPath('status', 'host')->assertJsonPath('online', 1);
        $this->assertSame(0, Room::query()->count());
        $this->assertNull(GlobalSeat::query()->where('user_id', $ana->id)->first());

        // the dead host's refresh and saves are refused from now on
        $this->actingAs($ana)->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'peer-ABCDEF', 'players' => 2])->assertNotFound();
        $this->putGzip($ana, '/api/world/global', gzencode('{}'))->assertStatus(409);
        Carbon::setTestNow();
    }

    public function test_the_hosts_refresh_keeps_the_players_it_lists_fresh(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $carl = $this->player('Carl');
        foreach ([$ana, $ben, $carl] as $p) {
            $this->actingAs($p)->postJson('/api/global/join');
        }
        $this->openRoom($ana)->assertCreated();

        Carbon::setTestNow(now()->addSeconds(GlobalSeat::STALE_SECONDS - 1));
        // Carl closed his tab; Ana only lists Ben
        $this->actingAs($ana)->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'peer-ABCDEF', 'players' => 2, 'user_ids' => [$ben->id]])->assertOk();
        Carbon::setTestNow(now()->addSeconds(10));
        $this->actingAs($this->player('Dee'))->postJson('/api/global/join')->assertOk()->assertJsonPath('online', 3);
        $this->assertSame([$ana->id, $ben->id], GlobalSeat::query()->orderBy('id')->pluck('user_id')->take(2)->all());
        $this->assertNull(GlobalSeat::query()->where('user_id', $carl->id)->first());
        Carbon::setTestNow();
    }

    public function test_a_player_who_left_cannot_claim_and_leaving_is_idempotent(): void
    {
        $ana = $this->player('Ana');
        $this->actingAs($ana)->postJson('/api/global/claim')->assertNotFound();
        $this->actingAs($ana)->postJson('/api/global/join')->assertOk();
        $this->actingAs($ana)->postJson('/api/global/leave')->assertOk();
        $this->actingAs($ana)->postJson('/api/global/leave')->assertOk();
        $this->assertSame(0, GlobalSeat::query()->count());
    }

    // ------------------------------------------------------------ the shared save
    public function test_the_global_save_is_one_row_only_its_host_writes_and_anyone_reads(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        $payload = gzencode(json_encode(['version' => 3, 'seed' => 11, 'edits' => [], 'players' => ['1' => [], '2' => []]]));

        // nobody hosts yet
        $this->putGzip($ana, '/api/world/global?night=1', $payload)->assertStatus(409);
        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($ben)->postJson('/api/global/join');

        $this->putGzip($ana, '/api/world/global?night=4&seconds=90', $payload)->assertOk()
            ->assertJsonPath('world.kind', 'global')->assertJsonPath('world.players', 2);
        $this->putGzip($ben, '/api/world/global?night=4', $payload)->assertStatus(409);
        $this->assertSame(1, World::query()->count());
        $this->assertNull(World::query()->first()->user_id);

        // everyone reads the same bytes; the beacon path is gated the same way
        $this->assertSame($payload, $this->actingAs($ben)->get('/api/world/global')->assertOk()->assertHeader('X-Save-Night', '4')->getContent());
        $file = UploadedFile::fake()->createWithContent('world.json.gz', $payload);
        $this->actingAs($ben)->post('/api/world/global/beacon', ['payload' => $file, 'night' => 5])->assertStatus(409);
        $this->actingAs($ana)->post('/api/world/global/beacon', ['payload' => $file, 'night' => 5])->assertOk()->assertJsonPath('world.night', 5);
        $this->assertSame(1, World::query()->count());

        // a player cannot start the global world over; their own world is untouched by it
        $this->actingAs($ana)->deleteJson('/api/world/global')->assertMethodNotAllowed();
        $this->actingAs($ana)->get('/api/world/global')->assertOk();
    }

    public function test_the_lobby_shows_the_shared_world_and_who_is_in_it(): void
    {
        $ana = $this->player('Ana');
        $ben = $this->player('Ben');
        World::create(['user_id' => null, 'kind' => 'global', 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 7, 'seconds' => 10]);

        $this->actingAs($ben)->get('/')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Play')
            ->where('worlds.global.night', 7)
            ->where('worlds.own', null)
            ->where('presence.online', 0)
            ->where('presence.host_name', null));

        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($ben)->get('/')->assertInertia(fn (Assert $page) => $page
            ->where('presence.online', 1)
            ->where('presence.host_name', 'Ana'));
    }

    // ------------------------------------------------------------ admin
    public function test_an_admin_resets_the_global_world_only_when_it_is_empty(): void
    {
        $admin = User::factory()->admin()->create(['name' => 'Root', 'email' => 'root@example.com']);
        $ana = $this->player('Ana');
        World::create(['user_id' => null, 'kind' => 'global', 'payload' => base64_encode(gzencode('{}')), 'size' => 22]);
        World::create(['user_id' => $ana->id, 'kind' => 'own', 'payload' => base64_encode(gzencode('{}')), 'size' => 22]);

        $this->actingAs($admin)->get('/admin')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->where('globalWorld.online', 0)->where('globalWorld.save.kind', 'global'));

        $this->actingAs($ana)->postJson('/api/global/join');
        $this->actingAs($admin)->delete('/admin/global-world')->assertRedirect()
            ->assertSessionHas('status', 'Someone is in the global world — reset it when it is empty.');
        $this->assertNotNull(World::global());

        $this->actingAs($ana)->postJson('/api/global/leave');
        $this->actingAs($admin)->delete('/admin/global-world')->assertRedirect()->assertSessionHas('status', 'The global world was reset.');
        $this->assertNull(World::global());
        $this->assertSame(1, World::query()->count()); // Ana's own world stays
    }
}
