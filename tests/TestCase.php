<?php

namespace Tests;

use App\Models\Device;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // the Inertia root view calls @vite; tests have no built manifest
        $this->withoutVite();
    }

    /** give this test's browser a device cookie; approved unless told otherwise */
    protected function device(?User $user = null, bool $approved = true): Device
    {
        $device = Device::create([
            'token' => Device::newToken(),
            'user_id' => $user?->id,
            'approved_at' => $approved ? now() : null,
        ]);
        // encrypted on the way in, like a real browser's cookie; JSON requests only carry
        // cookies with credentials on
        $this->withCredentials()->withCookie((string) config('admin.device_cookie'), $device->token);

        return $device;
    }

    /** sign in the way a player normally is: session plus an approved browser */
    protected function signIn(User $user): static
    {
        $this->device($user);

        return $this->actingAs($user);
    }
}
