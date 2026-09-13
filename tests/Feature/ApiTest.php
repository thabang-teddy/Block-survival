<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\RoomSignal;
use App\Models\Save;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class ApiTest extends TestCase
{
    use RefreshDatabase;

    /** a player whose browser an admin has already approved */
    private function user(string $name = 'Teddy', string $email = 'teddy@example.com'): User
    {
        $user = User::factory()->create(['name' => $name, 'email' => $email, 'password' => 'correct-horse']);
        $this->device($user);

        return $user;
    }

    /** raw PUT with a gzip body (the JSON helpers cannot send binary) */
    private function putGzip(User $user, string $uri, string $body)
    {
        return $this->actingAs($user)->call('PUT', $uri, [], $this->prepareCookiesForRequest(), [], [
            'CONTENT_TYPE' => 'application/gzip',
            'HTTP_ACCEPT' => 'application/json',
        ], $body);
    }

    // ------------------------------------------------------------ pages
    public function test_the_app_is_login_only(): void
    {
        $this->get('/')->assertRedirect('/login');
        $this->get('/login')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Login')
            ->where('auth.user', null));

        // a signed-in user is sent straight to the game, never back to the sign-in page
        $this->actingAs($this->user())->get('/login')->assertRedirect('/');
    }

    public function test_the_game_page_renders_with_lobby_props_for_the_signed_in_user(): void
    {
        $user = $this->user();
        Save::create(['user_id' => $user->id, 'slot' => 'main', 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 3, 'seconds' => 1800]);

        $this->actingAs($user)->get('/')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Play')
            ->where('auth.user.name', 'Teddy')
            ->has('leaderboard', 0)
            ->where('cloudSave.night', 3));
    }

    // ------------------------------------------------------------ session auth
    public function test_register_login_and_logout_through_the_session(): void
    {
        // a brand-new browser is parked until an admin approves it (DeviceApprovalTest covers that)
        $this->post('/register', ['name' => 'Teddy', 'email' => 'teddy@example.com', 'password' => 'correct-horse'])
            ->assertRedirect('/pending-approval');
        $this->assertGuest();
        $this->assertSame('Teddy', User::first()->name);

        $this->device(User::first());
        $this->post('/login', ['email' => 'teddy@example.com', 'password' => 'correct-horse'])->assertRedirect('/');
        $this->assertAuthenticated();

        $this->post('/logout')->assertRedirect('/login');
        $this->assertGuest();

        $this->post('/login', ['email' => 'teddy@example.com', 'password' => 'wrong'])
            ->assertSessionHasErrors('email');
        $this->assertGuest();
        $this->post('/login', ['email' => 'teddy@example.com', 'password' => 'correct-horse'])->assertRedirect('/');
        $this->assertAuthenticated();
    }

    public function test_login_returns_the_user_to_the_page_they_were_bounced_from(): void
    {
        $this->user();
        $this->get('/?room=ABCDEF')->assertRedirect('/login');
        $this->post('/login', ['email' => 'teddy@example.com', 'password' => 'correct-horse'])
            ->assertRedirectContains('/?room=ABCDEF');
    }

    public function test_register_rejects_bad_input_and_duplicates(): void
    {
        $this->user();
        $this->post('/register', ['name' => 'Teddy', 'email' => 'other@example.com', 'password' => 'correct-horse'])
            ->assertSessionHasErrors(['name']);
        $this->post('/register', ['name' => 'X', 'email' => 'nope', 'password' => 'short'])
            ->assertSessionHasErrors(['name', 'email', 'password']);
    }

    public function test_every_api_route_needs_a_session_and_never_redirects(): void
    {
        $this->getJson('/api/leaderboard')->assertUnauthorized();
        $this->getJson('/api/rooms')->assertUnauthorized();
        $this->postJson('/api/rooms', [])->assertUnauthorized();
        $this->getJson('/api/rooms/ABCDEF')->assertUnauthorized();
        $this->postJson('/api/rooms/ABCDEF/signal', [])->assertUnauthorized();
        $this->getJson('/api/rooms/ABCDEF/signals')->assertUnauthorized();
        $this->getJson('/api/saves')->assertUnauthorized();
        $this->postJson('/api/scores', [])->assertUnauthorized();
    }

    // ------------------------------------------------------------ rooms
    public function test_rooms_can_be_created_resolved_refreshed_and_closed(): void
    {
        $this->actingAs($this->user());
        $room = ['code' => 'ABCDEF', 'host_peer_id' => 'block-survival-ABCDEF', 'host_name' => 'Teddy'];
        $this->postJson('/api/rooms', $room)->assertCreated()->assertJsonPath('room.code', 'ABCDEF');
        $this->getJson('/api/rooms/abcdef')->assertOk()
            ->assertJsonPath('room.host_peer_id', 'block-survival-ABCDEF')
            ->assertJsonPath('room.players', 1);

        $this->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'block-survival-ABCDEF', 'players' => 3])
            ->assertOk()->assertJsonPath('room.players', 3);
        $this->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'someone-else', 'players' => 4])->assertNotFound();

        // another host cannot take a live code
        $this->postJson('/api/rooms', [...$room, 'host_peer_id' => 'intruder'])->assertStatus(409);

        $this->deleteJson('/api/rooms/ABCDEF', ['host_peer_id' => 'block-survival-ABCDEF'])->assertOk();
        $this->getJson('/api/rooms/ABCDEF')->assertNotFound();
    }

    public function test_expired_rooms_are_not_resolvable_and_codes_are_validated(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'QQQQQQ', 'host_peer_id' => 'p', 'host_name' => 'x', 'expires_at' => now()->subMinute()]);
        $this->getJson('/api/rooms/QQQQQQ')->assertNotFound();
        $this->postJson('/api/rooms', ['code' => 'ABCDEI', 'host_peer_id' => 'p', 'host_name' => 'x'])
            ->assertUnprocessable(); // I is not in the alphabet
    }

    public function test_room_is_linked_to_the_hosting_account(): void
    {
        $user = $this->user();
        $this->actingAs($user)
            ->postJson('/api/rooms', ['code' => 'HGFEDC', 'host_peer_id' => 'p', 'host_name' => 'Teddy'])
            ->assertCreated();
        $this->assertSame($user->id, Room::first()->user_id);
    }

    public function test_the_lobby_lists_open_rooms_without_their_peer_ids(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'OPENAA', 'host_peer_id' => 'p1', 'host_name' => 'Ana', 'players' => 2, 'expires_at' => now()->addHour()]);
        Room::create(['code' => 'FULLBB', 'host_peer_id' => 'p2', 'host_name' => 'Ben', 'players' => 4, 'expires_at' => now()->addHour()]);
        Room::create(['code' => 'GONECC', 'host_peer_id' => 'p3', 'host_name' => 'Cat', 'players' => 1, 'expires_at' => now()->subMinute()]);

        $this->getJson('/api/rooms')->assertOk()
            ->assertJsonCount(1, 'rooms')
            ->assertJsonPath('rooms.0.code', 'OPENAA')
            ->assertJsonPath('rooms.0.host_name', 'Ana')
            ->assertJsonPath('rooms.0.players', 2)
            ->assertJsonPath('rooms.0.max_players', 4)
            ->assertJsonMissingPath('rooms.0.host_peer_id')
            ->assertJsonMissingPath('rooms.0.user_id');
    }

    // ------------------------------------------------------------ signalling
    public function test_signals_are_stored_and_polled_per_recipient_after_a_cursor(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'expires_at' => now()->addHour()]);

        $offer = ['from' => 'clientBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['type' => 'offer', 'sdp' => 'v=0']];
        $first = $this->postJson('/api/rooms/abcdef/signal', $offer)->assertCreated()->json('id');
        $this->postJson('/api/rooms/ABCDEF/signal', [...$offer, 'type' => 'candidate', 'data' => ['candidate' => 'c1']])->assertCreated();
        // addressed to someone else: never returned to the host
        $this->postJson('/api/rooms/ABCDEF/signal', [...$offer, 'to' => 'clientBBBBBB', 'from' => 'hostAAAAAAAA', 'type' => 'answer'])->assertCreated();

        $res = $this->getJson('/api/rooms/abcdef/signals?to=hostAAAAAAAA&after=0')->assertOk();
        $signals = $res->json('signals');
        $this->assertCount(2, $signals);
        $this->assertSame(['offer', 'candidate'], array_column($signals, 'type'));
        $this->assertSame('clientBBBBBB', $signals[0]['from']);
        $this->assertSame('v=0', $signals[0]['data']['sdp']);
        $this->assertSame($first, $signals[0]['id']);

        // the cursor skips what was already delivered
        $this->getJson("/api/rooms/ABCDEF/signals?to=hostAAAAAAAA&after={$first}")
            ->assertOk()->assertJsonCount(1, 'signals')->assertJsonPath('signals.0.type', 'candidate');
        $this->getJson('/api/rooms/ABCDEF/signals?to=clientBBBBBB&after=0')
            ->assertOk()->assertJsonCount(1, 'signals')->assertJsonPath('signals.0.type', 'answer');
    }

    public function test_signal_endpoints_validate_and_reject_unknown_rooms(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'expires_at' => now()->addHour()]);
        $msg = ['from' => 'clientBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['type' => 'offer', 'sdp' => 'v=0']];

        $this->postJson('/api/rooms/NOPENO/signal', $msg)->assertNotFound();
        $this->postJson('/api/rooms/ABCDEF/signal', [...$msg, 'type' => 'hack'])->assertUnprocessable();
        $this->postJson('/api/rooms/ABCDEF/signal', [...$msg, 'from' => 'x'])->assertUnprocessable();
        $this->postJson('/api/rooms/ABCDEF/signal', [...$msg, 'data' => ['sdp' => str_repeat('a', 20000)]])->assertStatus(413);

        $this->getJson('/api/rooms/NOPENO/signals?to=hostAAAAAAAA&after=0')->assertNotFound();
        $this->getJson('/api/rooms/ABCDEF/signals?to=x&after=0')->assertUnprocessable();
        $this->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA&after=-1')->assertUnprocessable();
        $this->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA')->assertOk()->assertJsonCount(0, 'signals');
    }

    public function test_an_sdp_keeps_its_trailing_crlf_through_the_mailbox(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'expires_at' => now()->addHour()]);
        $sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=max-message-size:262144\r\n";
        $this->postJson('/api/rooms/ABCDEF/signal', ['from' => 'clientBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['type' => 'offer', 'sdp' => $sdp]])
            ->assertCreated();

        $this->assertSame($sdp, $this->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA')->json('signals.0.data.sdp'));
    }

    public function test_signals_are_pruned_with_their_room(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'expires_at' => now()->addHour()]);
        $msg = ['from' => 'clientBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['type' => 'offer', 'sdp' => 'v=0']];
        $this->postJson('/api/rooms/ABCDEF/signal', $msg)->assertCreated();
        RoomSignal::query()->update(['created_at' => now()->subHours(Room::TTL_HOURS + 1)]);
        $this->postJson('/api/rooms/ABCDEF/signal', $msg)->assertCreated();
        $this->assertSame(2, RoomSignal::count());

        // opening any room sweeps stale signals from every room
        $this->postJson('/api/rooms', ['code' => 'HGFEDC', 'host_peer_id' => 'p', 'host_name' => 'Teddy'])->assertCreated();
        $this->assertSame(1, RoomSignal::count());

        // closing the room drops what is left for it
        $this->deleteJson('/api/rooms/ABCDEF', ['host_peer_id' => 'hostAAAAAAAA'])->assertOk();
        $this->assertSame(0, RoomSignal::count());
    }

    // ------------------------------------------------------------ scores
    public function test_scores_are_recomputed_server_side_and_ranked(): void
    {
        $a = $this->user('Alice', 'a@example.com');
        $b = $this->user('Bob', 'b@example.com');

        $this->actingAs($a)->postJson('/api/scores', ['nights' => 2, 'kills' => 13, 'deaths' => 1, 'seconds' => 900, 'score' => 999999])
            ->assertCreated()->assertJsonPath('score', 265)->assertJsonPath('best', 265);
        $this->actingAs($a)->postJson('/api/scores', ['nights' => 1, 'kills' => 0, 'deaths' => 0, 'seconds' => 300])
            ->assertCreated()->assertJsonPath('best', 265);
        $this->actingAs($b)->postJson('/api/scores', ['nights' => 3, 'kills' => 0, 'deaths' => 4, 'seconds' => 1500])
            ->assertCreated()->assertJsonPath('score', 300);

        $this->getJson('/api/leaderboard')->assertOk()->assertJson([
            'leaderboard' => [
                ['name' => 'Bob', 'score' => 300],
                ['name' => 'Alice', 'score' => 265],
            ],
        ]);
        $this->actingAs($a)->get('/')->assertInertia(fn (Assert $page) => $page->has('leaderboard', 2)->where('leaderboard.0.name', 'Bob'));
        $this->actingAs($a)->postJson('/api/scores', ['nights' => -1, 'kills' => 0, 'deaths' => 0, 'seconds' => 0])
            ->assertUnprocessable();
    }

    // ------------------------------------------------------------ saves
    public function test_saves_round_trip_as_gzip_and_are_private_per_user(): void
    {
        $a = $this->user('Alice', 'a@example.com');
        $b = $this->user('Bob', 'b@example.com');
        $payload = gzencode(json_encode(['seed' => 11, 'edits' => [[1, 2, 3, 4]]]));

        $this->putGzip($a, '/api/saves/main?night=2&seconds=700', $payload)
            ->assertOk()->assertJsonPath('save.slot', 'main')->assertJsonPath('save.night', 2);

        $res = $this->actingAs($a)->get('/api/saves/main')->assertOk()
            ->assertHeader('Content-Type', 'application/gzip')
            ->assertHeader('X-Save-Night', '2');
        $this->assertSame($payload, $res->getContent());

        $this->actingAs($a)->getJson('/api/saves')->assertOk()->assertJsonCount(1, 'saves')->assertJsonPath('saves.0.slot', 'main');
        $this->actingAs($b)->getJson('/api/saves/main')->assertNotFound();
        $this->actingAs($b)->getJson('/api/saves')->assertOk()->assertJsonCount(0, 'saves');

        $this->actingAs($a)->deleteJson('/api/saves/main')->assertOk();
        $this->actingAs($a)->getJson('/api/saves/main')->assertNotFound();
    }

    public function test_saves_reject_non_gzip_bad_slots_and_oversized_bodies(): void
    {
        $a = $this->user();
        $this->putGzip($a, '/api/saves/main', 'not gzip')->assertUnprocessable();
        $this->putGzip($a, '/api/saves/BadSlot!', gzencode('{}'))->assertUnprocessable();
        $this->putGzip($a, '/api/saves/main', '')->assertStatus(413);
    }
}
