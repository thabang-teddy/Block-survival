<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Manage users. An admin can never demote, disable or delete themselves, and
 * the ADMIN_EMAIL account is only ever changed through .env.
 */
class UserController extends Controller
{
    public function toggleAdmin(Request $request, User $user): RedirectResponse
    {
        $this->notSelf($request, $user, 'You cannot change your own admin status.');
        $this->notEnvAdmin($user);
        $user->update(['is_admin' => ! $user->is_admin]);

        return back()->with('status', $user->is_admin ? "{$user->name} is now an admin." : "{$user->name} is no longer an admin.");
    }

    public function toggleDisabled(Request $request, User $user): RedirectResponse
    {
        $this->notSelf($request, $user, 'You cannot disable your own account.');
        $this->notEnvAdmin($user);
        $user->update(['is_disabled' => ! $user->is_disabled]);

        return back()->with('status', $user->is_disabled ? "{$user->name} disabled." : "{$user->name} enabled.");
    }

    public function destroy(Request $request, User $user): RedirectResponse
    {
        $this->notSelf($request, $user, 'You cannot delete your own account.');
        $this->notEnvAdmin($user);
        // scores, saves and devices cascade; rooms keep running with user_id nulled
        $user->delete();

        return back()->with('status', "{$user->name} deleted.");
    }

    private function notSelf(Request $request, User $user, string $message): void
    {
        if ($request->user()->is($user)) {
            throw ValidationException::withMessages(['user' => $message]);
        }
    }

    private function notEnvAdmin(User $user): void
    {
        if ($user->isEnvAdmin()) {
            throw ValidationException::withMessages(['user' => 'That account is the ADMIN_EMAIL admin; change it in .env.']);
        }
    }
}
