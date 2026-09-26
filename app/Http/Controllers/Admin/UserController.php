<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Player accounts are created and changed here and nowhere else (there is no
 * self-registration or password reset). An admin can never demote, disable or
 * delete themselves, and the ADMIN_EMAIL account is only ever changed through .env.
 */
class UserController extends Controller
{
    private const NAME_RULES = ['required', 'string', 'min:2', 'max:16', 'regex:/^[\pL\pN _-]+$/u'];

    public function index(): Response
    {
        return Inertia::render('Admin/Users', [
            'users' => User::query()->withCount('devices')->with('world')->orderBy('name')->get()
                ->map(fn (User $u) => $this->row($u))->all(),
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('Admin/UserForm', ['user' => null]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name' => [...self::NAME_RULES, 'unique:users,name'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            // insecure passwords are allowed on purpose: this is a private server
            'password' => ['required', 'string', 'min:1', 'max:255'],
            'is_admin' => ['required', 'boolean'],
            'is_disabled' => ['required', 'boolean'],
        ]);

        $user = User::create($data);

        return redirect()->route('admin.users.index')->with('status', "{$user->name} created.");
    }

    public function edit(User $user): Response
    {
        return Inertia::render('Admin/UserForm', ['user' => $this->row($user->loadCount('devices')->load('world'))]);
    }

    public function update(Request $request, User $user): RedirectResponse
    {
        $data = $request->validate([
            'name' => [...self::NAME_RULES, Rule::unique('users', 'name')->ignore($user)],
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user)],
            'password' => ['nullable', 'string', 'min:1', 'max:255'],
            'is_admin' => ['required', 'boolean'],
            'is_disabled' => ['required', 'boolean'],
        ]);

        $this->guardFlags($request, $user, $data);
        if ($data['password'] === null || $data['password'] === '') {
            unset($data['password']); // blank = keep the current one
        }
        $user->update($data);

        return redirect()->route('admin.users.index')->with('status', "{$user->name} saved.");
    }

    public function destroy(Request $request, User $user): RedirectResponse
    {
        $this->notSelf($request, $user, 'You cannot delete your own account.');
        $this->notEnvAdmin($user, 'That account is the ADMIN_EMAIL admin; remove it from .env first.');
        // scores, world and devices cascade; rooms keep running with user_id nulled
        $user->delete();

        return redirect()->route('admin.users.index')->with('status', "{$user->name} deleted.");
    }

    /** wipes the player's own world (the shared global world is reset from the dashboard) */
    public function resetWorld(User $user): RedirectResponse
    {
        $user->worlds()->delete();

        return back()->with('status', "{$user->name}'s world was reset.");
    }

    /** @param array<string, mixed> $data */
    private function guardFlags(Request $request, User $user, array $data): void
    {
        $flagsChanged = (bool) $data['is_admin'] !== $user->isAdmin() || (bool) $data['is_disabled'] !== $user->is_disabled;
        if ($flagsChanged) {
            $this->notSelf($request, $user, 'You cannot change your own admin or disabled status.');
            $this->notEnvAdmin($user, 'That account is the ADMIN_EMAIL admin; its role cannot change here.');
        }
        if ($user->isEnvAdmin() && strcasecmp($data['email'], $user->email) !== 0) {
            throw ValidationException::withMessages(['email' => 'That address is ADMIN_EMAIL; change it in .env.']);
        }
    }

    private function notSelf(Request $request, User $user, string $message): void
    {
        if ($request->user()->is($user)) {
            throw ValidationException::withMessages(['user' => $message]);
        }
    }

    private function notEnvAdmin(User $user, string $message): void
    {
        if ($user->isEnvAdmin()) {
            throw ValidationException::withMessages(['user' => $message]);
        }
    }

    /** @return array<string, mixed> */
    private function row(User $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'email' => $u->email,
            'is_admin' => $u->isAdmin(),
            'is_env_admin' => $u->isEnvAdmin(),
            'is_disabled' => $u->is_disabled,
            'devices_count' => $u->devices_count ?? 0,
            'world' => $u->world?->meta(),
            'last_login_at' => $u->last_login_at?->toIso8601String(),
            'created_at' => $u->created_at?->toIso8601String(),
        ];
    }
}
