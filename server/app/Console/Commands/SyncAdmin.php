<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Creates or updates the admin account named in .env (ADMIN_EMAIL / ADMIN_PASSWORD /
 * ADMIN_NAME) and marks it as admin. Idempotent; the deploy script runs it after
 * migrations so a fresh install always has one admin who can approve devices.
 */
class SyncAdmin extends Command
{
    protected $signature = 'admin:sync';

    protected $description = 'Create or update the admin user from ADMIN_EMAIL / ADMIN_PASSWORD in .env';

    public function handle(): int
    {
        $email = (string) config('admin.email');
        $password = (string) config('admin.password');
        if ($email === '') {
            $this->warn('ADMIN_EMAIL is not set; nothing to do.');

            return self::SUCCESS;
        }

        $user = User::query()->where('email', $email)->first();
        if (! $user && $password === '') {
            $this->error("No user with email {$email} and ADMIN_PASSWORD is empty, so it cannot be created.");

            return self::FAILURE;
        }

        $attributes = ['is_admin' => true, 'is_disabled' => false];
        if ($password !== '') {
            $attributes['password'] = $password;
        }
        if (! $user) {
            $attributes += ['name' => $this->uniqueName((string) config('admin.name')), 'email' => $email];
        }

        $user = User::query()->updateOrCreate(['email' => $email], $attributes);
        $this->info("{$user->email} is an admin".($password !== '' ? ' (password set from .env).' : '.'));

        return self::SUCCESS;
    }

    /** player names are unique; fall back to "Admin 2" if a player already took "Admin" */
    private function uniqueName(string $base): string
    {
        $base = mb_substr($base !== '' ? $base : 'Admin', 0, 14);
        $name = $base;
        for ($i = 2; User::query()->where('name', $name)->exists(); $i++) {
            $name = "{$base} {$i}";
        }

        return $name;
    }
}
