<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\User;
use App\Support\AccessPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Token sign-in for the native client (docs/flutter-client-plan.md D2 / S5).
 *
 * The client cannot hold the browser's session cookie, so it exchanges the same
 * credentials for a Sanctum personal-access token. The three gates of the
 * AccessPolicy apply exactly as they do to a browser: the account is enabled, the
 * login window is open, and the *device* has been approved by an admin. A browser
 * is a device row keyed by a cookie; the native client generates its own 64-char
 * device token once, keeps it in secure storage, and sends it with every sign-in,
 * so the row it creates shows up on the admin's device page like any other PC.
 * No token is issued until that row is approved; the client polls `status`.
 */
class AuthController extends Controller
{
    public function __construct(private readonly AccessPolicy $policy) {}

    /** credentials + device → token, or 403 while the device waits for approval */
    public function token(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device.token' => ['required', 'string', 'regex:'.Device::TOKEN_PATTERN],
            'device.name' => ['required', 'string', 'max:40'],
        ]);

        // explicitly the session guard's provider: the default guard may be `sanctum` here
        if (! Auth::guard('web')->validate(['email' => $data['email'], 'password' => $data['password']])) {
            throw ValidationException::withMessages(['email' => 'Wrong email or password.']);
        }
        $user = User::query()->where('email', $data['email'])->firstOrFail();

        if ($reason = $this->policy->blockedReason($user)) {
            return response()->json(['message' => $reason], Response::HTTP_FORBIDDEN);
        }

        $device = $this->policy->deviceForToken($request, $data['device']['token'], $data['device']['name'], $user);
        if (! $this->policy->deviceAllowed($user, $device)) {
            return response()->json([
                'message' => 'This device is waiting for admin approval.',
                'pending' => true,
                'device' => ['id' => $device->id, 'approved' => false],
            ], Response::HTTP_FORBIDDEN);
        }

        $user->forceFill(['last_login_at' => now()])->save();
        $token = $user->createToken($data['device']['name']);
        $token->accessToken->forceFill(['device_id' => $device->id])->save();

        return response()->json([
            'token' => $token->plainTextToken,
            'user' => self::userPayload($user),
        ], Response::HTTP_CREATED);
    }

    /** approval state of a device token, for the client to poll while parked */
    public function status(Request $request): JsonResponse
    {
        $device = Device::findByToken($request->query('device'));

        return response()->json(['known' => $device !== null, 'approved' => $device?->isApproved() ?? false]);
    }

    /** who the token belongs to, plus the worlds they can load */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['user' => self::userPayload($user), 'worlds' => $user->worldsMeta()]);
    }

    /** revoke the token that made the request */
    public function logout(Request $request): Response
    {
        $token = $request->user()?->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        return response()->noContent();
    }

    /** @return array{id: int, name: string, email: string, is_admin: bool} */
    public static function userPayload(User $user): array
    {
        return ['id' => $user->id, 'name' => $user->name, 'email' => $user->email, 'is_admin' => $user->isAdmin()];
    }
}
