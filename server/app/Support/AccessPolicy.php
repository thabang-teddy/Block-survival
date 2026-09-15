<?php

namespace App\Support;

use App\Models\Device;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Cookie as CookieValue;

/**
 * Who may be signed in right now. Three gates, checked at sign-in and on every
 * authenticated request: the account is not disabled, the login window is open,
 * and the browser has been approved by an admin. Admins pass every gate.
 */
final class AccessPolicy
{
    private const COOKIE_MINUTES = 60 * 24 * 365;

    /** why this user may not be signed in right now, or null if they may */
    public function blockedReason(User $user): ?string
    {
        if ($user->is_disabled) {
            return 'This account has been disabled.';
        }
        if ($user->isAdmin()) {
            return null;
        }
        $window = LoginWindow::fromSettings();
        if (! $window->isOpen(now())) {
            return $window->describeNextOpening(now());
        }

        return null;
    }

    /** the browser's device row, created (and its cookie queued) on first sight */
    public function device(Request $request, ?User $user = null): Device
    {
        $device = Device::findByToken($request->cookie((string) config('admin.device_cookie')));
        if (! $device) {
            $device = Device::create(['token' => Device::newToken()]);
            Cookie::queue($this->cookieFor($device, $request));
        }
        $device->fill([
            'user_id' => $user?->id ?? $device->user_id,
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 255),
            'ip' => $request->ip(),
            'last_seen_at' => now(),
        ])->save();

        return $device;
    }

    /** the device row for the cookie, without creating one (for the pending page) */
    public function knownDevice(Request $request): ?Device
    {
        return Device::findByToken($request->cookie((string) config('admin.device_cookie')));
    }

    public function deviceAllowed(User $user, ?Device $device): bool
    {
        return $user->isAdmin() || ($device !== null && $device->isApproved());
    }

    private function cookieFor(Device $device, Request $request): CookieValue
    {
        // encrypted by the EncryptCookies middleware; never readable from JS
        return Cookie::make(
            name: (string) config('admin.device_cookie'),
            value: $device->token,
            minutes: self::COOKIE_MINUTES,
            path: '/',
            secure: $request->isSecure(),
            httpOnly: true,
            sameSite: 'lax',
        );
    }
}
