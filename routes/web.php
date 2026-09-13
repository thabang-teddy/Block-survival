<?php

use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\DeviceController;
use App\Http\Controllers\Admin\LoginWindowController;
use App\Http\Controllers\Admin\RoomController as AdminRoomController;
use App\Http\Controllers\Admin\UserController;
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
        Route::get('/rooms', [RoomController::class, 'index']);
        Route::post('/rooms', [RoomController::class, 'store']);
        Route::get('/rooms/{code}', [RoomController::class, 'show']);
        Route::patch('/rooms/{code}', [RoomController::class, 'update']);
        Route::delete('/rooms/{code}', [RoomController::class, 'destroy']);
        Route::get('/leaderboard', [ScoreController::class, 'leaderboard']);
        Route::post('/scores', [ScoreController::class, 'store']);
        // the player's one world
        Route::get('/world', [WorldController::class, 'show']);
        Route::put('/world', [WorldController::class, 'update']);
        Route::delete('/world', [WorldController::class, 'destroy']);
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
        Route::get('/rooms', [AdminRoomController::class, 'index'])->name('rooms.index');
        Route::delete('/rooms/{code}', [AdminRoomController::class, 'destroy'])->name('rooms.destroy');
    });
});
