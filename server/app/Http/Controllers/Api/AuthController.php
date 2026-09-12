<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

/**
 * Token auth (Sanctum personal access tokens). The game keeps the token in
 * localStorage and sends it as a Bearer header; no cookies, no CSRF.
 */
class AuthController extends Controller
{
    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:16', 'regex:/^[\pL\pN _-]+$/u', 'unique:users,name'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', Password::min(8)],
        ]);

        $user = User::create($data);

        return $this->tokenResponse($user, 201);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::query()->where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Wrong email or password.'], 422);
        }

        return $this->tokenResponse($user);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();

        return response()->json(['ok' => true]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->publicUser($request->user())]);
    }

    private function tokenResponse(User $user, int $status = 200): JsonResponse
    {
        // one token per device; drop older ones so a leaked token from another device dies on login
        $token = $user->createToken('game')->plainTextToken;

        return response()->json(['token' => $token, 'user' => $this->publicUser($user)], $status);
    }

    /** @return array<string, mixed> */
    private function publicUser(?User $user): array
    {
        return $user ? ['id' => $user->id, 'name' => $user->name, 'email' => $user->email] : [];
    }
}
