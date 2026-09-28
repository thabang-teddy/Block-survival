<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\AccessPolicy;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Session auth for the Inertia app. The app is login-only: guests see the Login
 * page, and a successful sign-in lands on the game page (or the page they were
 * sent to /login from) — unless the AccessPolicy says otherwise: a closed login
 * window or a disabled account is refused, and a browser no admin has approved
 * yet is parked on /pending-approval. Accounts are created by an admin; there
 * is no registration or password reset.
 *
 * In the local (dev) environment only, the sign-in page also offers a one-click
 * guest account: the first click creates it, every click signs in as it, and the
 * browser is approved on the spot so the game is reachable without an admin.
 */
class AuthController extends Controller
{
    public const GUEST_EMAIL = 'guest@localhost';

    public const GUEST_NAME = 'Guest';

    public function __construct(private readonly AccessPolicy $policy) {}

    public function show(): Response
    {
        return Inertia::render('Login', [
            'guestLogin' => self::guestLoginEnabled(),
            'guestExists' => self::guestLoginEnabled() && User::query()->where('email', self::GUEST_EMAIL)->exists(),
        ]);
    }

    /** dev only: the guest button is hidden (and its route 404s) on staging and production */
    public static function guestLoginEnabled(): bool
    {
        return (bool) config('admin.guest_login');
    }

    /** dev only: create the guest account on first use, then sign in as it, skipping the gates */
    public function guest(Request $request): RedirectResponse
    {
        abort_unless(self::guestLoginEnabled(), 404);

        $user = User::query()->firstOrCreate(
            ['email' => self::GUEST_EMAIL],
            ['name' => self::GUEST_NAME, 'password' => 'guest'],
        );
        if ($user->is_disabled) {
            throw ValidationException::withMessages(['email' => 'The guest account has been disabled.']);
        }

        // no admin around in dev: this browser is approved for the guest right now
        $device = $this->policy->device($request, $user);
        if (! $device->isApproved()) {
            $device->forceFill(['approved_at' => now(), 'label' => 'dev guest'])->save();
        }

        Auth::login($user, remember: true);
        $request->session()->regenerate();
        $user->forceFill(['last_login_at' => now()])->save();

        return redirect()->intended('/');
    }

    public function login(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        // check the credentials without opening a session: the gates below may still refuse
        if (! Auth::validate($data)) {
            throw ValidationException::withMessages(['email' => 'Wrong email or password.']);
        }

        return $this->admit($request, User::query()->where('email', $data['email'])->firstOrFail());
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/login');
    }

    /** credentials are good — open the session if the policy allows it */
    private function admit(Request $request, User $user): RedirectResponse
    {
        if ($reason = $this->policy->blockedReason($user)) {
            throw ValidationException::withMessages(['email' => $reason]);
        }

        $device = $this->policy->device($request, $user);
        if (! $this->policy->deviceAllowed($user, $device)) {
            return redirect('/pending-approval');
        }

        Auth::login($user, remember: true);
        $request->session()->regenerate();
        $user->forceFill(['last_login_at' => now()])->save();

        return redirect()->intended('/');
    }
}
