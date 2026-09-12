<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiTest extends TestCase
{
    use RefreshDatabase;

    private function register(string $name = 'Teddy', string $email = 'teddy@example.com'): string
    {
        $res = $this->postJson('/api/auth/register', ['name' => $name, 'email' => $email, 'password' => 'correct-horse'])
            ->assertCreated()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email']]);

        return $res->json('token');
    }

    /** raw PUT with a gzip body; call() bypasses withToken(), so the header is passed explicitly */
    private function putGzip(string $token, string $uri, string $body)
    {
        return $this->call('PUT', $uri, [], [], [], [
            'CONTENT_TYPE' => 'application/gzip',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_AUTHORIZATION' => "Bearer $token",
        ], $body);
    }

    /** the guard caches the resolved user for the test process; drop it between requests */
    private function freshGuard(): void
    {
        $this->app['auth']->forgetGuards();
    }

    // ------------------------------------------------------------ auth
    public function test_register_login_me_logout(): void
    {
        $token = $this->register();
        $this->withToken($token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('user.name', 'Teddy');

        $login = $this->postJson('/api/auth/login', ['email' => 'teddy@example.com', 'password' => 'correct-horse'])
            ->assertOk()->json('token');
        $this->freshGuard();
        $this->withToken($login)->postJson('/api/auth/logout')->assertOk();
        $this->freshGuard();
        $this->withToken($login)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_register_rejects_bad_input_and_duplicates(): void
    {
        $this->register();
        $this->postJson('/api/auth/register', ['name' => 'Teddy', 'email' => 'other@example.com', 'password' => 'correct-horse'])
            ->assertUnprocessable()->assertJsonValidationErrors(['name']);
        $this->postJson('/api/auth/register', ['name' => 'X', 'email' => 'nope', 'password' => 'short'])
            ->assertUnprocessable()->assertJsonValidationErrors(['name', 'email', 'password']);
        $this->postJson('/api/auth/login', ['email' => 'teddy@example.com', 'password' => 'wrong'])
            ->assertUnprocessable();
    }

    public function test_protected_routes_need_a_token(): void
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
        $token = $this->register();
        $this->withToken($token)
            ->postJson('/api/rooms', ['code' => 'HGFEDC', 'host_peer_id' => 'p', 'host_name' => 'Teddy'])
            ->assertCreated();
        $this->assertSame(User::first()->id, Room::first()->user_id);
    }

    // ------------------------------------------------------------ scores
    public function test_scores_are_recomputed_server_side_and_ranked(): void
    {
        $a = $this->register('Alice', 'a@example.com');
        $b = $this->register('Bob', 'b@example.com');

        $this->withToken($a)->postJson('/api/scores', ['nights' => 2, 'kills' => 13, 'deaths' => 1, 'seconds' => 900, 'score' => 999999])
            ->assertCreated()->assertJsonPath('score', 265)->assertJsonPath('best', 265);
        $this->withToken($a)->postJson('/api/scores', ['nights' => 1, 'kills' => 0, 'deaths' => 0, 'seconds' => 300])
            ->assertCreated()->assertJsonPath('best', 265);
        $this->freshGuard();
        $this->freshGuard();
        $this->withToken($b)->postJson('/api/scores', ['nights' => 3, 'kills' => 0, 'deaths' => 4, 'seconds' => 1500])
            ->assertCreated()->assertJsonPath('score', 300);

        $this->getJson('/api/leaderboard')->assertOk()->assertJson([
            'leaderboard' => [
                ['name' => 'Bob', 'score' => 300],
                ['name' => 'Alice', 'score' => 265],
            ],
        ]);
        $this->freshGuard();
        $this->withToken($a)->postJson('/api/scores', ['nights' => -1, 'kills' => 0, 'deaths' => 0, 'seconds' => 0])
            ->assertUnprocessable();
    }

    // ------------------------------------------------------------ saves
    public function test_saves_round_trip_as_gzip_and_are_private_per_user(): void
    {
        $a = $this->register('Alice', 'a@example.com');
        $b = $this->register('Bob', 'b@example.com');
        $payload = gzencode(json_encode(['seed' => 11, 'edits' => [[1, 2, 3, 4]]]));

        $this->putGzip($a, '/api/saves/main?night=2&seconds=700', $payload)
            ->assertOk()->assertJsonPath('save.slot', 'main')->assertJsonPath('save.night', 2);

        $this->freshGuard();
        $res = $this->withToken($a)->get('/api/saves/main')->assertOk()
            ->assertHeader('Content-Type', 'application/gzip')
            ->assertHeader('X-Save-Night', '2');
        $this->assertSame($payload, $res->getContent());

        $this->withToken($a)->getJson('/api/saves')->assertOk()->assertJsonCount(1, 'saves')->assertJsonPath('saves.0.slot', 'main');
        $this->freshGuard();
        $this->withToken($b)->getJson('/api/saves/main')->assertNotFound();
        $this->withToken($b)->getJson('/api/saves')->assertOk()->assertJsonCount(0, 'saves');

        $this->freshGuard();
        $this->withToken($a)->deleteJson('/api/saves/main')->assertOk();
        $this->withToken($a)->getJson('/api/saves/main')->assertNotFound();
    }

    public function test_saves_reject_non_gzip_bad_slots_and_oversized_bodies(): void
    {
        $a = $this->register();
        $this->putGzip($a, '/api/saves/main', 'not gzip')->assertUnprocessable();
        $this->putGzip($a, '/api/saves/BadSlot!', gzencode('{}'))->assertUnprocessable();
        $this->putGzip($a, '/api/saves/main', '')->assertStatus(413);
    }
}
