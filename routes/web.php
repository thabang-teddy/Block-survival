<?php

use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\DeviceController;
use App\Http\Controllers\Admin\LoginWindowController;
use App\Http\Controllers\Admin\RoomController as AdminRoomController;
use App\Http\Controllers\Admin\UserController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\SaveController;
use App\Http\Controllers\Api\ScoreController;
use App\Http\Controllers\Api\SignalController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\PendingApprovalController;
use App\Http\Controllers\PlayController;
use Illuminate\Support\Facades\Route;

// The app is login-only: the sign-in page is the sole thing a guest can see.
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'show'])->name('login');
    // rate-limited against brute force
    Route::middleware('throttle:10,1')->group(function () {
        Route::post('/register', [AuthController::class, 'register'])->name('register');
        Route::post('/login', [AuthController::class, 'login'])->name('login.store');
    });
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
        Route::get('/saves', [SaveController::class, 'index']);
        Route::get('/saves/{slot}', [SaveController::class, 'show']);
        Route::put('/saves/{slot}', [SaveController::class, 'update']);
        Route::delete('/saves/{slot}', [SaveController::class, 'destroy']);
    });

    // admin section (issue #1): operating hours, device approval, users, live rooms
    Route::prefix('admin')->middleware('admin')->name('admin.')->group(function () {
        Route::get('/', DashboardController::class)->name('index');
        Route::put('/login-window', [LoginWindowController::class, 'update'])->name('login-window');
        Route::post('/devices/{device}/approve', [DeviceController::class, 'approve'])->name('devices.approve');
        Route::patch('/devices/{device}', [DeviceController::class, 'update'])->name('devices.update');
        Route::delete('/devices/{device}', [DeviceController::class, 'destroy'])->name('devices.destroy');
        Route::post('/users/{user}/toggle-admin', [UserController::class, 'toggleAdmin'])->name('users.toggle-admin');
        Route::post('/users/{user}/toggle-disabled', [UserController::class, 'toggleDisabled'])->name('users.toggle-disabled');
        Route::delete('/users/{user}', [UserController::class, 'destroy'])->name('users.destroy');
        Route::delete('/rooms/{code}', [AdminRoomController::class, 'destroy'])->name('rooms.destroy');
    });
});
