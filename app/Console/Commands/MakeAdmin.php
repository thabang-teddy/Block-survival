<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/** Promote an existing player to admin from the shell (cPanel terminal). */
class MakeAdmin extends Command
{
    protected $signature = 'user:make-admin {email : the account to promote}';

    protected $description = 'Give an existing user admin rights and approve their devices';

    public function handle(): int
    {
        $user = User::query()->where('email', $this->argument('email'))->first();
        if (! $user) {
            $this->error("No user with email {$this->argument('email')}.");

            return self::FAILURE;
        }

        $user->update(['is_admin' => true, 'is_disabled' => false]);
        // admins bypass approval anyway; approving keeps the device list honest
        $user->devices()->pending()->update(['approved_at' => now(), 'approved_by' => $user->id]);
        $this->info("{$user->email} is now an admin.");

        return self::SUCCESS;
    }
}
