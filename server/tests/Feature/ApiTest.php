<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\RoomInvite;
use App\Models\RoomSignal;
use App\Models\User;
use App\Models\World;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
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
        World::create(['user_id' => $user->id, 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 3, 'seconds' => 1800]);
        World::create(['user_id' => null, 'kind' => 'global', 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 7, 'seconds' => 10]);

        $this->actingAs($user)->get('/')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Play')
            ->where('auth.user.name', 'Teddy')
            ->has('leaderboard', 0)
            ->where('worlds.own.night', 3)
            ->where('worlds.own.kind', 'own')
            ->where('worlds.global.night', 7)
            ->where('presence.online', 0));
    }

    // ------------------------------------------------------------ session auth
    public function test_login_and_logout_through_the_session(): void
    {
        $this->user();
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

    public function test_there_is_no_self_registration_and_short_passwords_sign_in(): void
    {
        $this->post('/register', ['name' => 'Teddy', 'email' => 'teddy@example.com', 'password' => 'correct-horse'])->assertNotFound();

        // insecure passwords are allowed on purpose: accounts are handed out by the admin
        $user = User::factory()->create(['email' => 'short@example.com', 'password' => '1']);
        $this->device($user);
        $this->post('/login', ['email' => 'short@example.com', 'password' => '1'])->assertRedirect('/');
        $this->assertAuthenticated();
    }

    public function test_every_api_route_needs_a_session_and_never_redirects(): void
    {
        $this->getJson('/api/leaderboard')->assertUnauthorized();
        $this->getJson('/api/invites')->assertUnauthorized();
        $this->getJson('/api/players')->assertUnauthorized();
        $this->postJson('/api/rooms', [])->assertUnauthorized();
        $this->getJson('/api/rooms/ABCDEF')->assertUnauthorized();
        $this->postJson('/api/rooms/ABCDEF/signal', [])->assertUnauthorized();
        $this->getJson('/api/rooms/ABCDEF/signals')->assertUnauthorized();
        $this->getJson('/api/world')->assertUnauthorized();
        $this->getJson('/api/world/global')->assertUnauthorized();
        $this->postJson('/api/scores', [])->assertUnauthorized();
    }

    // ------------------------------------------------------------ rooms
    public function test_rooms_can_be_created_resolved_refreshed_and_closed(): void
    {
        $this->actingAs($this->user());
        $room = ['code' => 'ABCDEF', 'host_peer_id' => 'block-survival-ABCDEF', 'host_name' => 'Teddy', 'world_kind' => 'own'];
        $this->postJson('/api/rooms', $room)->assertCreated()->assertJsonPath('room.code', 'ABCDEF')->assertJsonPath('room.world_kind', 'own');
        $this->getJson('/api/rooms/abcdef')->assertOk()
            ->assertJsonPath('room.host_peer_id', 'block-survival-ABCDEF')
            ->assertJsonPath('room.players', 1);
        $this->postJson('/api/rooms', [...$room, 'code' => 'ABCDEG', 'world_kind' => 'nope'])->assertUnprocessable();

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
        $me = $this->user();
        $this->actingAs($me);
        Room::create(['code' => 'QQQQQQ', 'host_peer_id' => 'p', 'host_name' => 'x', 'user_id' => $me->id, 'expires_at' => now()->subMinute()]);
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

    public function test_there_is_no_open_games_list_any_more(): void
    {
        $this->actingAs($this->user());
        Room::create(['code' => 'OPENAA', 'host_peer_id' => 'p1', 'host_name' => 'Ana', 'players' => 2, 'expires_at' => now()->addHour()]);
        $this->getJson('/api/rooms')->assertStatus(405);
    }

    // ------------------------------------------------------------ invites (issue #5)
    public function test_joining_a_room_takes_an_accepted_invitation(): void
    {
        $host = $this->user('Host', 'host@example.com');
        $guest = $this->user('Guest', 'guest@example.com');
        $other = $this->user('Other', 'other@example.com');
        $this->actingAs($host)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'Host'])->assertCreated();

        // the host sees everyone else; a guest cannot invite into a room they do not host
        $this->actingAs($host)->getJson('/api/players')->assertOk()->assertJsonCount(2, 'players')->assertJsonPath('players.0.name', 'Guest');
        $this->actingAs($guest)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $other->id])->assertForbidden();
        $this->actingAs($host)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $host->id])->assertUnprocessable();
        $this->actingAs($host)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $guest->id])
            ->assertCreated()->assertJsonPath('invite.name', 'Guest')->assertJsonPath('invite.status', 'pending');
        // inviting again is a no-op
        $this->actingAs($host)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $guest->id])->assertOk();
        $this->assertSame(1, RoomInvite::count());

        // without an accepted invite the code resolves to nothing and the mailbox is shut
        $this->actingAs($guest)->getJson('/api/rooms/ABCDEF')->assertForbidden();
        $this->actingAs($other)->getJson('/api/rooms/ABCDEF')->assertForbidden();
        $this->actingAs($guest)->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA')->assertForbidden();
        $this->actingAs($guest)->postJson('/api/rooms/ABCDEF/signal', ['from' => 'guestBBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['sdp' => 'v=0']])->assertForbidden();

        // only the invitee sees the invite
        $this->actingAs($other)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');
        $id = $this->actingAs($guest)->getJson('/api/invites')->assertOk()
            ->assertJsonCount(1, 'invites')
            ->assertJsonPath('invites.0.code', 'ABCDEF')
            ->assertJsonPath('invites.0.host_name', 'Host')
            ->assertJsonPath('invites.0.world_kind', 'own')
            ->assertJsonMissingPath('invites.0.host_peer_id')
            ->json('invites.0.id');
        $this->actingAs($host)->getJson('/api/rooms/ABCDEF/invites')->assertOk()->assertJsonCount(1, 'invites')->assertJsonPath('invites.0.status', 'pending');

        // accepting is where the peer id comes from; then the code resolves and signalling works
        $this->actingAs($other)->postJson("/api/invites/{$id}/accept")->assertForbidden();
        $this->actingAs($guest)->postJson("/api/invites/{$id}/accept")->assertOk()->assertJsonPath('room.host_peer_id', 'hostAAAAAAAA');
        $this->actingAs($guest)->getJson('/api/rooms/ABCDEF')->assertOk()->assertJsonPath('room.host_peer_id', 'hostAAAAAAAA');
        $this->actingAs($guest)->postJson('/api/rooms/ABCDEF/signal', ['from' => 'guestBBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['sdp' => 'v=0']])->assertCreated();
        $this->actingAs($host)->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA')->assertOk()->assertJsonCount(1, 'signals');
        $this->actingAs($host)->getJson('/api/rooms/ABCDEF/invites')->assertOk()->assertJsonPath('invites.0.status', 'accepted');
        // an accepted invite stays in the lobby, so the guest can go back in while the host is hosting
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(1, 'invites')->assertJsonPath('invites.0.status', 'accepted');
    }

    public function test_declined_full_and_dead_invites_stay_out_of_the_lobby(): void
    {
        $host = $this->user('Host', 'host@example.com');
        $guest = $this->user('Guest', 'guest@example.com');
        $room = Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'p', 'host_name' => 'Host', 'user_id' => $host->id, 'expires_at' => now()->addHour()]);
        $invite = RoomInvite::create(['room_id' => $room->id, 'from_user_id' => $host->id, 'to_user_id' => $guest->id]);

        $this->actingAs($guest)->postJson("/api/invites/{$invite->id}/decline")->assertOk();
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');
        $this->actingAs($guest)->postJson("/api/invites/{$invite->id}/accept")->assertStatus(409);
        $this->actingAs($guest)->getJson('/api/rooms/ABCDEF')->assertForbidden();

        // the host can ask again after a decline
        $this->actingAs($host)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $guest->id])->assertOk()->assertJsonPath('invite.status', 'pending');
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(1, 'invites');

        $room->update(['players' => 4]);
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');
        $room->update(['players' => 1, 'expires_at' => now()->subMinute()]);
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');
        $this->actingAs($guest)->postJson("/api/invites/{$invite->id}/accept")->assertStatus(410);

        // invites die with their room
        $this->actingAs($host)->deleteJson('/api/rooms/ABCDEF', ['host_peer_id' => 'p'])->assertOk();
        $this->assertSame(0, RoomInvite::count());
    }

    public function test_a_room_whose_host_went_quiet_is_not_hosting_until_it_refreshes(): void
    {
        $host = $this->user('Host', 'host@example.com');
        $guest = $this->user('Guest', 'guest@example.com');
        $this->actingAs($host)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'Host'])->assertCreated();
        $invite = $this->actingAs($host)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $guest->id])->json('invite.id');
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(1, 'invites');

        // the host's tab died without closing the room: two hours of TTL left, but not hosting
        Carbon::setTestNow(now()->addSeconds(Room::HOSTING_SECONDS + 1));
        $this->actingAs($guest)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');
        $this->actingAs($guest)->postJson("/api/invites/{$invite}/accept")->assertStatus(410);
        // the host itself still reaches its room and mailbox
        $this->actingAs($host)->getJson('/api/rooms/ABCDEF')->assertOk();
        $this->actingAs($host)->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA')->assertOk();

        // a refresh is a sign of life: hosting again
        $this->actingAs($host)->patchJson('/api/rooms/ABCDEF', ['host_peer_id' => 'hostAAAAAAAA', 'players' => 1])->assertOk();
        $this->actingAs($guest)->postJson("/api/invites/{$invite}/accept")->assertOk();
        $this->actingAs($guest)->getJson('/api/rooms/ABCDEF/signals?to=guestBBBBBBB')->assertOk();

        // an accepted invitee is shut out again once the host goes quiet
        Carbon::setTestNow(now()->addSeconds(Room::HOSTING_SECONDS + 1));
        $this->actingAs($guest)->getJson('/api/rooms/ABCDEF')->assertForbidden();
        $this->actingAs($guest)->postJson('/api/rooms/ABCDEF/signal', ['from' => 'guestBBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['sdp' => 'v=0']])->assertForbidden();
        Carbon::setTestNow();
    }

    public function test_invites_follow_the_host_into_their_next_room(): void
    {
        $host = $this->user('Host', 'host@example.com');
        $ana = $this->user('Ana', 'ana@example.com');
        $ben = $this->user('Ben', 'ben@example.com');
        $cat = $this->user('Cat', 'cat@example.com');
        $this->actingAs($host)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'Host'])->assertCreated();
        foreach ([$ana, $ben, $cat] as $u) {
            $this->actingAs($host)->postJson('/api/rooms/ABCDEF/invites', ['user_id' => $u->id])->assertCreated();
        }
        $accepted = RoomInvite::query()->where('to_user_id', $ana->id)->value('id');
        $this->actingAs($ana)->postJson("/api/invites/{$accepted}/accept")->assertOk();
        $declined = RoomInvite::query()->where('to_user_id', $cat->id)->value('id');
        $this->actingAs($cat)->postJson("/api/invites/{$declined}/decline")->assertOk();

        // a room that is still hosting keeps its invites when the host opens another one
        $this->actingAs($host)->postJson('/api/rooms', ['code' => 'GHJKLM', 'host_peer_id' => 'hostCCCCCCCC', 'host_name' => 'Host'])->assertCreated();
        $this->assertSame(3, Room::query()->where('code', 'ABCDEF')->first()->invites()->count());
        $this->actingAs($host)->deleteJson('/api/rooms/GHJKLM', ['host_peer_id' => 'hostCCCCCCCC'])->assertOk();

        // the host's tab crashed; after a reload they host again under a new code
        Carbon::setTestNow(now()->addSeconds(Room::HOSTING_SECONDS + 1));
        $this->actingAs($host)->postJson('/api/rooms', ['code' => 'NPQRST', 'host_peer_id' => 'hostBBBBBBBB', 'host_name' => 'Host'])->assertCreated();
        $new = Room::query()->where('code', 'NPQRST')->first();
        $this->assertEqualsCanonicalizing([$ana->id, $ben->id], $new->invites()->pluck('to_user_id')->all());

        // Ana (accepted) goes straight back in; Ben still sees his invite, now to the new room
        $this->actingAs($ana)->getJson('/api/rooms/NPQRST')->assertOk()->assertJsonPath('room.host_peer_id', 'hostBBBBBBBB');
        $this->actingAs($ben)->getJson('/api/invites')->assertOk()->assertJsonCount(1, 'invites')->assertJsonPath('invites.0.code', 'NPQRST');
        // Cat's decline stays with the old room
        $this->actingAs($cat)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');

        // stopping cleanly ends the invites
        $this->actingAs($host)->deleteJson('/api/rooms/NPQRST', ['host_peer_id' => 'hostBBBBBBBB'])->assertOk();
        $this->actingAs($ben)->getJson('/api/invites')->assertOk()->assertJsonCount(0, 'invites');
        Carbon::setTestNow();
    }

    public function test_an_invitee_invited_into_two_dead_rooms_keeps_one_invite(): void
    {
        $host = $this->user('Host', 'host@example.com');
        $ana = $this->user('Ana', 'ana@example.com');
        $old = Room::create(['code' => 'AAAAAA', 'host_peer_id' => 'p1', 'host_name' => 'Host', 'user_id' => $host->id, 'expires_at' => now()->addHour(), 'last_seen_at' => now()->subMinutes(5)]);
        $older = Room::create(['code' => 'BBBBBB', 'host_peer_id' => 'p2', 'host_name' => 'Host', 'user_id' => $host->id, 'expires_at' => now()->addHour(), 'last_seen_at' => now()->subMinutes(9)]);
        RoomInvite::create(['room_id' => $older->id, 'from_user_id' => $host->id, 'to_user_id' => $ana->id, 'status' => RoomInvite::ACCEPTED]);
        $newest = RoomInvite::create(['room_id' => $old->id, 'from_user_id' => $host->id, 'to_user_id' => $ana->id]);

        $this->actingAs($host)->postJson('/api/rooms', ['code' => 'CCCCCC', 'host_peer_id' => 'p3', 'host_name' => 'Host'])->assertCreated();
        $this->assertSame(1, RoomInvite::count());
        $this->assertSame($newest->id, RoomInvite::query()->where('room_id', Room::query()->where('code', 'CCCCCC')->value('id'))->value('id'));
    }

    // ------------------------------------------------------------ signalling
    public function test_signals_are_stored_and_polled_per_recipient_after_a_cursor(): void
    {
        $me = $this->user();
        $this->actingAs($me);
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'user_id' => $me->id, 'expires_at' => now()->addHour()]);

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
        $me = $this->user();
        $this->actingAs($me);
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'user_id' => $me->id, 'expires_at' => now()->addHour()]);
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
        $me = $this->user();
        $this->actingAs($me);
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'user_id' => $me->id, 'expires_at' => now()->addHour()]);
        $sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=max-message-size:262144\r\n";
        $this->postJson('/api/rooms/ABCDEF/signal', ['from' => 'clientBBBBBB', 'to' => 'hostAAAAAAAA', 'type' => 'offer', 'data' => ['type' => 'offer', 'sdp' => $sdp]])
            ->assertCreated();

        $this->assertSame($sdp, $this->getJson('/api/rooms/ABCDEF/signals?to=hostAAAAAAAA')->json('signals.0.data.sdp'));
    }

    public function test_signals_are_pruned_with_their_room(): void
    {
        $me = $this->user();
        $this->actingAs($me);
        Room::create(['code' => 'ABCDEF', 'host_peer_id' => 'hostAAAAAAAA', 'host_name' => 'x', 'user_id' => $me->id, 'expires_at' => now()->addHour()]);
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

    // ------------------------------------------------------------ the player's world
    public function test_each_player_has_one_private_world_that_round_trips_as_gzip(): void
    {
        $a = $this->user('Alice', 'a@example.com');
        $b = $this->user('Bob', 'b@example.com');
        $payload = gzencode(json_encode(['seed' => 11, 'edits' => [[1, 2, 3, 4]]]));

        $this->putGzip($a, '/api/world?night=2&seconds=700', $payload)
            ->assertOk()->assertJsonPath('world.night', 2)->assertJsonPath('world.seconds', 700);

        $res = $this->actingAs($a)->get('/api/world')->assertOk()
            ->assertHeader('Content-Type', 'application/gzip')
            ->assertHeader('X-Save-Night', '2');
        $this->assertSame($payload, $res->getContent());

        // saving again replaces the one world rather than adding a second
        $this->putGzip($a, '/api/world?night=5&seconds=900', $payload)->assertOk()->assertJsonPath('world.night', 5);
        $this->assertSame(1, World::query()->where('user_id', $a->id)->count());
        $this->actingAs($b)->getJson('/api/world')->assertNotFound();

        $this->actingAs($a)->deleteJson('/api/world')->assertOk();
        $this->actingAs($a)->getJson('/api/world')->assertNotFound();
        $this->actingAs($a)->deleteJson('/api/world')->assertOk(); // idempotent
    }

    public function test_own_and_global_worlds_are_saved_independently(): void
    {
        $a = $this->user();
        $own = gzencode(json_encode(['version' => 3, 'seed' => 123456, 'edits' => [], 'players' => []]));
        $global = gzencode(json_encode(['version' => 3, 'seed' => 11, 'edits' => [[1]], 'players' => []]));
        $this->actingAs($a)->postJson('/api/global/join')->assertOk(); // the global world's host

        $this->putGzip($a, '/api/world/own?night=1', $own)->assertOk()->assertJsonPath('world.kind', 'own');
        $this->putGzip($a, '/api/world/global?night=9', $global)->assertOk()->assertJsonPath('world.kind', 'global');
        $this->putGzip($a, '/api/world/other', $global)->assertNotFound();
        $this->assertSame(1, World::query()->where('user_id', $a->id)->count());
        $this->assertSame(1, World::query()->whereNull('user_id')->count());

        $this->assertSame($own, $this->actingAs($a)->get('/api/world')->assertOk()->getContent());
        $this->assertSame($own, $this->actingAs($a)->get('/api/world/own')->assertOk()->getContent());
        $this->assertSame($global, $this->actingAs($a)->get('/api/world/global')->assertOk()->assertHeader('X-Save-Night', '9')->getContent());

        // starting over in the own world leaves the global one alone
        $this->actingAs($a)->deleteJson('/api/world/own')->assertOk();
        $this->actingAs($a)->getJson('/api/world/own')->assertNotFound();
        $this->actingAs($a)->get('/api/world/global')->assertOk();
        $this->actingAs($a)->get('/')->assertInertia(fn (Assert $page) => $page->where('worlds.own', null)->where('worlds.global.night', 9));

        // the beacon takes a kind too
        $file = UploadedFile::fake()->createWithContent('world.json.gz', $own);
        $this->actingAs($a)->post('/api/world/global/beacon', ['payload' => $file, 'night' => 2])->assertOk()->assertJsonPath('world.kind', 'global');
        $this->assertSame($own, $this->actingAs($a)->get('/api/world/global')->getContent());
    }

    public function test_the_world_rejects_non_gzip_and_oversized_bodies(): void
    {
        $a = $this->user();
        $this->putGzip($a, '/api/world', 'not gzip')->assertUnprocessable();
        $this->putGzip($a, '/api/world', '')->assertStatus(413);
        $this->putGzip($a, '/api/world', str_repeat('x', World::MAX_BYTES + 1))->assertStatus(413);
    }

    public function test_the_world_counts_the_players_it_holds_gear_for(): void
    {
        $a = $this->user();
        $v3 = gzencode(json_encode(['version' => 3, 'seed' => 11, 'edits' => [], 'players' => ['1' => [], '2' => [], '3' => []]]));
        $this->putGzip($a, '/api/world?night=1', $v3)->assertOk()->assertJsonPath('world.players', 3);
        $this->actingAs($a)->get('/')->assertInertia(fn (Assert $page) => $page->where('worlds.own.players', 3));

        // a v2 save (no players map) counts as the host alone
        $v2 = gzencode(json_encode(['version' => 2, 'seed' => 11, 'edits' => []]));
        $this->putGzip($a, '/api/world', $v2)->assertOk()->assertJsonPath('world.players', 1);
    }

    /** a closing tab posts the save as a beacon: multipart with the gzip as a file */
    public function test_the_world_can_be_saved_by_a_beacon_on_unload(): void
    {
        $a = $this->user();
        $payload = gzencode(json_encode(['version' => 3, 'seed' => 5, 'edits' => [], 'players' => ['1' => []]]));
        $file = UploadedFile::fake()->createWithContent('world.json.gz', $payload);

        $this->actingAs($a)->post('/api/world/beacon', ['payload' => $file, 'night' => 4, 'seconds' => 321])
            ->assertOk()->assertJsonPath('world.night', 4)->assertJsonPath('world.seconds', 321)->assertJsonPath('world.players', 1);
        $res = $this->actingAs($a)->get('/api/world')->assertOk()->assertHeader('X-Save-Night', '4');
        $this->assertSame($payload, $res->getContent());

        $this->actingAs($a)->post('/api/world/beacon', ['night' => 4])->assertUnprocessable();
        $bad = UploadedFile::fake()->createWithContent('world.json', 'plain json');
        $this->actingAs($a)->post('/api/world/beacon', ['payload' => $bad])->assertUnprocessable();
    }
}
