<?php

namespace Tests\Feature;

use App\Http\Middleware\PreventRequestForgeryUnlessBearer;
use App\Models\Device;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Token sign-in for the native client (docs/flutter-client-plan.md S5): the same
 * three gates as the browser, a Sanctum token instead of a session, and the
 * browser's own session + CSRF flow untouched.
 */
class TokenAuthTest extends TestCase
{
    use RefreshDatabase;

    private const CREDENTIALS = ['email' => 'teddy@example.com', 'password' => 'correct-horse'];

    private string $deviceToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->deviceToken = Str::random(Device::TOKEN_LENGTH);
    }

    private function player(): User
    {
        return User::factory()->create(['name' => 'Teddy', ...self::CREDENTIALS]);
    }

    /** @return array<string, mixed> */
    private function tokenRequest(array $overrides = []): array
    {
        return [...self::CREDENTIALS, 'device' => ['token' => $this->deviceToken, 'name' => 'Teddy’s laptop'], ...$overrides];
    }

    private function approvedDevice(User $user): Device
    {
        return Device::create(['token' => $this->deviceToken, 'user_id' => $user->id, 'approved_at' => now()]);
    }

    /** sign in on the approved device and return the token */
    private function issueToken(): string
    {
        $this->asNobody();

        return $this->postJson('/api/auth/token', $this->tokenRequest())->assertCreated()->json('token');
    }

    /**
     * A fresh caller: no headers from the previous request, and Sanctum's request
     * guard forgets the user it resolved (each real request has its own guard).
     */
    private function asNobody(): static
    {
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();

        return $this;
    }

    private function asToken(string $token): static
    {
        return $this->asNobody()->withToken($token);
    }

    // ------------------------------------------------------------ the three gates
    public function test_wrong_credentials_are_refused_without_creating_a_device(): void
    {
        $this->player();

        $this->postJson('/api/auth/token', $this->tokenRequest(['password' => 'nope']))
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertSame(0, Device::count());
        $this->assertSame(0, PersonalAccessToken::count());
    }

    public function test_the_device_token_must_look_like_one(): void
    {
        $this->player();

        $this->postJson('/api/auth/token', $this->tokenRequest(['device' => ['token' => 'short', 'name' => 'x']]))
            ->assertUnprocessable()->assertJsonValidationErrors('device.token');
    }

    public function test_a_new_device_is_parked_until_an_admin_approves_it(): void
    {
        $user = $this->player();

        $this->postJson('/api/auth/token', $this->tokenRequest())
            ->assertForbidden()->assertJson(['pending' => true, 'device' => ['approved' => false]]);
        $this->assertSame(0, PersonalAccessToken::count());

        $device = Device::sole();
        $this->assertSame($this->deviceToken, $device->token);
        $this->assertSame($user->id, $device->user_id);
        $this->assertSame('Teddy’s laptop', $device->label);
        $this->assertNull($device->approved_at);

        // the client polls until an admin approves the device on /admin/devices
        $this->getJson('/api/auth/status?device='.$this->deviceToken)->assertOk()->assertJson(['known' => true, 'approved' => false]);
        $this->getJson('/api/auth/status?device=nonsense')->assertOk()->assertJson(['known' => false, 'approved' => false]);

        $admin = User::factory()->admin()->create();
        $this->actingAs($admin)->post("/admin/devices/{$device->id}/approve")->assertRedirect();
        $this->getJson('/api/auth/status?device='.$this->deviceToken)->assertOk()->assertJson(['known' => true, 'approved' => true]);

        // second attempt on the approved device: a token comes back
        $this->postJson('/api/auth/token', $this->tokenRequest())->assertCreated()->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'is_admin']]);
    }

    public function test_a_disabled_account_and_a_closed_window_are_refused(): void
    {
        $user = $this->player();
        $this->approvedDevice($user);

        $user->forceFill(['is_disabled' => true])->save();
        $this->postJson('/api/auth/token', $this->tokenRequest())->assertForbidden()->assertJsonPath('message', 'This account has been disabled.')->assertJsonMissingPath('pending');

        $user->forceFill(['is_disabled' => false])->save();
        Setting::setMany(['login_window_enabled' => '1', 'login_window_start' => '18:00', 'login_window_end' => '22:00', 'login_window_days' => '1,2,3,4,5', 'login_window_timezone' => 'UTC']);
        Carbon::setTestNow('2026-09-16 09:00:00');
        $this->postJson('/api/auth/token', $this->tokenRequest())->assertForbidden()->assertJsonPath('message', fn (string $m) => str_starts_with($m, 'The server is closed'));
        $this->assertSame(0, PersonalAccessToken::count());
    }

    public function test_admins_skip_device_approval(): void
    {
        User::factory()->admin()->create(self::CREDENTIALS);

        $this->postJson('/api/auth/token', $this->tokenRequest())->assertCreated()->assertJsonPath('user.is_admin', true);
        $this->assertNull(Device::sole()->approved_at);
    }

    // ------------------------------------------------------------ using the token
    public function test_the_token_reaches_the_json_api_without_a_session_or_csrf_token(): void
    {
        $user = $this->player();
        $device = $this->approvedDevice($user);

        $token = $this->postJson('/api/auth/token', $this->tokenRequest())->assertCreated()->json('token');
        $this->assertSame($device->id, PersonalAccessToken::sole()->device_id);
        $this->assertNotNull($user->fresh()->last_login_at);

        $this->asToken($token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('user.id', $user->id)->assertJsonStructure(['worlds' => ['own', 'global']]);
        $this->asToken($token)->getJson('/api/leaderboard')->assertOk();
        $this->asToken($token)->postJson('/api/rooms', ['code' => 'ABCDEF', 'host_peer_id' => 'peer-1', 'host_name' => 'Teddy'])->assertSuccessful();
        $this->asNobody()->getJson('/api/leaderboard')->assertUnauthorized();
        $this->asToken('not-a-token')->getJson('/api/leaderboard')->assertUnauthorized();
    }

    /**
     * CSRF checks are switched off under the test runner, so the exemption rule is
     * checked directly: only a bearer-token call to /api with no session login skips it.
     */
    public function test_csrf_is_only_skipped_for_bearer_calls_without_a_session_login(): void
    {
        $user = $this->player();
        $exempt = function (Request $request): bool {
            $middleware = $this->app->make(PreventRequestForgeryUnlessBearer::class);
            $method = new \ReflectionMethod($middleware, 'inExceptArray');

            return $method->invoke($middleware, $request);
        };
        $session = $this->app['session']->driver();
        $sessionRequest = function (string $uri, ?string $bearer) use ($session): Request {
            $request = Request::create($uri, 'POST', server: $bearer ? ['HTTP_AUTHORIZATION' => 'Bearer '.$bearer] : []);
            $request->setLaravelSession($session);

            return $request;
        };

        $this->assertTrue($exempt($sessionRequest('/api/rooms', 'abc')), 'bearer + no session login');
        $this->assertTrue($exempt($sessionRequest('/api/auth/token', null)), 'sign-in has no token yet');
        $this->assertFalse($exempt($sessionRequest('/api/rooms', null)), 'no bearer');
        $this->assertFalse($exempt($sessionRequest('/logout', 'abc')), 'bearer outside /api');

        $session->put(Auth::guard('web')->getName(), $user->id);
        $this->assertFalse($exempt($sessionRequest('/api/rooms', 'abc')), 'bearer + signed-in session keeps CSRF');
    }

    public function test_logout_revokes_only_the_token_that_made_the_request(): void
    {
        $user = $this->player();
        $this->approvedDevice($user);
        $first = $this->issueToken();
        $second = $this->issueToken();
        $this->assertSame(2, PersonalAccessToken::count());

        $this->asToken($first)->postJson('/api/auth/logout')->assertNoContent();
        $this->asToken($first)->getJson('/api/auth/me')->assertUnauthorized();
        $this->asToken($second)->getJson('/api/auth/me')->assertOk();
    }

    public function test_revoking_the_device_or_the_account_kills_its_tokens(): void
    {
        $user = $this->player();
        $device = $this->approvedDevice($user);
        $token = $this->issueToken();

        // the admin un-approves the device: the next call is refused and the token is gone
        $device->forceFill(['approved_at' => null])->save();
        $this->asToken($token)->getJson('/api/leaderboard')->assertForbidden()
            ->assertJsonPath('message', 'This PC is waiting for admin approval.');
        $this->assertSame(0, PersonalAccessToken::count());

        // a deleted device takes its tokens with it
        $device->forceFill(['approved_at' => now()])->save();
        $token = $this->issueToken();
        $device->delete();
        $this->assertSame(0, PersonalAccessToken::count());
        $this->asToken($token)->getJson('/api/leaderboard')->assertUnauthorized();

        // a disabled account is refused on its next call
        $this->approvedDevice($user);
        $token = $this->issueToken();
        $user->forceFill(['is_disabled' => true])->save();
        $this->asToken($token)->getJson('/api/leaderboard')->assertForbidden()->assertJsonPath('message', 'This account has been disabled.');
        $this->assertSame(0, PersonalAccessToken::count());
    }

    public function test_the_browser_login_flow_is_unchanged(): void
    {
        $user = $this->player();

        $this->post('/login', self::CREDENTIALS)->assertRedirect('/pending-approval')->assertCookie('bs_device');
        $device = Device::sole();
        $device->forceFill(['approved_at' => now()])->save();
        $this->withCredentials()->withCookie('bs_device', $device->token);
        $this->post('/login', self::CREDENTIALS)->assertRedirect('/');
        $this->assertAuthenticatedAs($user, 'web');
        $this->getJson('/api/leaderboard')->assertOk();
        $this->assertSame(0, PersonalAccessToken::count());
    }
}
