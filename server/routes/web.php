<?php

use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\DeviceController;
use App\Http\Controllers\Admin\GlobalWorldController as AdminGlobalWorldController;
use App\Http\Controllers\Admin\LoginWindowController;
use App\Http\Controllers\Admin\RoomController as AdminRoomController;
use App\Http\Controllers\Admin\UserController;
use App\Http\Controllers\Api\GlobalWorldController;
use App\Http\Controllers\Api\InviteController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\ScoreController;
use App\Http\Controllers\Api\SignalController;
use App\Http\Controllers\Api\WorldController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\PendingApprovalController;
use App\Http\Controllers\PlayController;
use Illuminate\Support\Facades\Route;

// The app is login-only: the sign-in page is the sole thing a guest can see.
// There is no self-registration or password reset — admins create accounts.
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'show'])->name('login');
    // rate-limited against brute force
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1')->name('login.store');
    // dev only (404 elsewhere): one-click guest account
    Route::post('/login/guest', [AuthController::class, 'guest'])->middleware('throttle:10,1')->name('login.guest');
    // a browser no admin has approved yet waits here (identified by its cookie, not a session)
    Route::get('/pending-approval', [PendingApprovalController::class, 'show'])->name('pending-approval');
    Route::get('/pending-approval/status', [PendingApprovalController::class, 'status'])->middleware('throttle:30,1');
});

// `access` ends the session when the account is disabled, the login window closes
// or the browser's approval is revoked; admins are exempt
Route::middleware(['auth', 'access'])->group(function () {
    Route::get('/', PlayController::class)->name('play');
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');

    // WebRTC signalling is polled at up to 2 Hz per browser, so it gets its own,
    // looser limit instead of the general 60/min below (the two would stack)
    Route::prefix('api')->middleware('throttle:signal')->group(function () {
        Route::post('/rooms/{code}/signal', [SignalController::class, 'store']);
        Route::get('/rooms/{code}/signals', [SignalController::class, 'index']);
    });

    // JSON endpoints used by the running game; same session + CSRF as the page
    Route::prefix('api')->middleware('throttle:60,1')->group(function () {
        // rooms are invite-only (issue #5): there is no open list, and resolving a code
        // needs an accepted invite
        Route::post('/rooms', [RoomController::class, 'store']);
        Route::get('/rooms/{code}', [RoomController::class, 'show']);
        Route::patch('/rooms/{code}', [RoomController::class, 'update']);
        Route::delete('/rooms/{code}', [RoomController::class, 'destroy']);
        Route::get('/rooms/{code}/invites', [InviteController::class, 'room']);
        Route::post('/rooms/{code}/invites', [InviteController::class, 'store']);
        Route::get('/players', [InviteController::class, 'players']);
        Route::get('/invites', [InviteController::class, 'index']);
        Route::post('/invites/{invite}/accept', [InviteController::class, 'accept']);
        Route::post('/invites/{invite}/decline', [InviteController::class, 'decline']);
        Route::get('/leaderboard', [ScoreController::class, 'leaderboard']);
        Route::post('/scores', [ScoreController::class, 'store']);
        // the shared global world: enter its queue, ask who hosts now, leave
        Route::post('/global/join', [GlobalWorldController::class, 'join']);
        Route::post('/global/claim', [GlobalWorldController::class, 'claim']);
        Route::post('/global/leave', [GlobalWorldController::class, 'leave']);
        // the player's own world (`own`, random seed; no kind = own) and the shared `global` one;
        // only the player's own can be started over — an admin resets the global world
        Route::get('/world/{kind?}', [WorldController::class, 'show'])->where('kind', 'own|global');
        Route::put('/world/{kind?}', [WorldController::class, 'update'])->where('kind', 'own|global');
        Route::delete('/world/{kind?}', [WorldController::class, 'destroy'])->where('kind', 'own');
        // sendBeacon on unload: multipart, CSRF token as a form field
        Route::post('/world/beacon', [WorldController::class, 'beacon']);
        Route::post('/world/{kind}/beacon', [WorldController::class, 'beacon'])->where('kind', 'own|global');
    });

    // admin section (issue #1): operating hours, device approval, users, live rooms
    Route::prefix('admin')->middleware('admin')->name('admin.')->group(function () {
        Route::get('/', DashboardController::class)->name('index');
        Route::get('/hours', [LoginWindowController::class, 'show'])->name('hours');
        Route::put('/hours', [LoginWindowController::class, 'update'])->name('hours.update');
        Route::get('/devices', [DeviceController::class, 'index'])->name('devices.index');
        Route::post('/devices/{device}/approve', [DeviceController::class, 'approve'])->name('devices.approve');
        Route::patch('/devices/{device}', [DeviceController::class, 'update'])->name('devices.update');
        Route::delete('/devices/{device}', [DeviceController::class, 'destroy'])->name('devices.destroy');
        Route::get('/users', [UserController::class, 'index'])->name('users.index');
        Route::get('/users/create', [UserController::class, 'create'])->name('users.create');
        Route::post('/users', [UserController::class, 'store'])->name('users.store');
        Route::get('/users/{user}/edit', [UserController::class, 'edit'])->name('users.edit');
        Route::put('/users/{user}', [UserController::class, 'update'])->name('users.update');
        Route::delete('/users/{user}', [UserController::class, 'destroy'])->name('users.destroy');
        Route::delete('/users/{user}/world', [UserController::class, 'resetWorld'])->name('users.reset-world');
        Route::delete('/global-world', AdminGlobalWorldController::class)->name('global-world.reset');
        Route::get('/rooms', [AdminRoomController::class, 'index'])->name('rooms.index');
        Route::delete('/rooms/{code}', [AdminRoomController::class, 'destroy'])->name('rooms.destroy');
    });
});
