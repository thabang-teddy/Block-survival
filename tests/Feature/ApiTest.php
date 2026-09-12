<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\Save;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class ApiTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $name = 'Teddy', string $email = 'teddy@example.com'): User
    {
        return User::factory()->create(['name' => $name, 'email' => $email, 'password' => 'correct-horse']);
    }

    /** raw PUT with a gzip body (the JSON helpers cannot send binary) */
    private function putGzip(User $user, string $uri, string $body)
    {
        return $this->actingAs($user)->call('PUT', $uri, [], [], [], [
            'CONTENT_TYPE' => 'application/gzip',
            'HTTP_ACCEPT' => 'application/json',
        ], $body);
    }

    // ------------------------------------------------------------ page
    public function test_the_game_page_renders_with_menu_props(): void
    {
        $this->get('/')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Play')
            ->where('auth.user', null)
            ->has('leaderboard', 0)
            ->where('cloudSave', null));

        $user = $this->user();
        Save::create(['user_id' => $user->id, 'slot' => 'main', 'payload' => base64_encode(gzencode('{}')), 'size' => 22, 'night' => 3, 'seconds' => 1800]);
        $this->actingAs($user)->get('/')->assertInertia(fn (Assert $page) => $page
            ->where('auth.user.name', 'Teddy')
            ->where('cloudSave.night', 3));
    }

    // ------------------------------------------------------------ session auth
    public function test_register_login_and_logout_through_the_session(): void
    {
        $this->post('/register', ['name' => 'Teddy', 'email' => 'teddy@example.com', 'password' => 'correct-horse'])
            ->assertRedirect('/');
        $this->assertAuthenticated();
        $this->assertSame('Teddy', User::first()->name);

        $this->post('/logout')->assertRedirect('/');
        $this->assertGuest();

        $this->post('/login', ['email' => 'teddy@example.com', 'password' => 'wrong'])
            ->assertSessionHasErrors('email');
        $this->assertGuest();
        $this->post('/login', ['email' => 'teddy@example.com', 'password' => 'correct-horse'])->assertRedirect('/');
        $this->assertAuthenticated();
    }

    public function test_register_rejects_bad_input_and_duplicates(): void
    {
        $this->user();
        $this->post('/register', ['name' => 'Teddy', 'email' => 'other@example.com', 'password' => 'correct-horse'])
            ->assertSessionHasErrors(['name']);
        $this->post('/register', ['name' => 'X', 'email' => 'nope', 'password' => 'short'])
            ->assertSessionHasErrors(['name', 'email', 'password']);
    }

    public function test_protected_api_routes_need_a_session(): void
    {
        $this->getJson('/api/saves')->assertUnauthorized();
        $this->postJson('/api/scores', [])->assertUnauthorized();
    }

    // ------------------------------------------------------------ rooms
    public function test_rooms_can_be_created_resolved_refreshed_and_closed_by_guests(): void
    {
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
        Room::create(['code' => 'QQQQQQ', 'host_peer_id' => 'p', 'host_name' => 'x', 'expires_at' => now()->subMinute()]);
        $this->getJson('/api/rooms/QQQQQQ')->assertNotFound();
        $this->postJson('/api/rooms', ['code' => 'ABCDEI', 'host_peer_id' => 'p', 'host_name' => 'x'])
            ->assertUnprocessable(); // I is not in the alphabet
    }

    public function test_room_is_linked_to_the_account_when_logged_in(): void
    {
        $user = $this->user();
        $this->actingAs($user)
            ->postJson('/api/rooms', ['code' => 'HGFEDC', 'host_peer_id' => 'p', 'host_name' => 'Teddy'])
            ->assertCreated();
        $this->assertSame($user->id, Room::first()->user_id);
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
        $this->get('/')->assertInertia(fn (Assert $page) => $page->has('leaderboard', 2)->where('leaderboard.0.name', 'Bob'));
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
