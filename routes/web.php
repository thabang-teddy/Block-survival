<?php

use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\SaveController;
use App\Http\Controllers\Api\ScoreController;
use App\Http\Controllers\Api\SignalController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\PlayController;
use Illuminate\Support\Facades\Route;

Route::get('/', PlayController::class)->name('play');

// session auth for the Inertia menu (rate-limited against brute force)
Route::middleware('throttle:10,1')->group(function () {
    Route::post('/register', [AuthController::class, 'register'])->name('register');
    Route::post('/login', [AuthController::class, 'login'])->name('login');
});
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth')->name('logout');

// WebRTC signalling is polled at up to 2 Hz per browser, so it gets its own,
// looser limit instead of the general 60/min below (the two would stack)
Route::prefix('api')->middleware('throttle:signal')->group(function () {
    Route::post('/rooms/{code}/signal', [SignalController::class, 'store']);
    Route::get('/rooms/{code}/signals', [SignalController::class, 'index']);
});

// JSON endpoints used by the running game; same session + CSRF as the page
Route::prefix('api')->middleware('throttle:60,1')->group(function () {
    Route::post('/rooms', [RoomController::class, 'store']);
    Route::get('/rooms/{code}', [RoomController::class, 'show']);
    Route::patch('/rooms/{code}', [RoomController::class, 'update']);
    Route::delete('/rooms/{code}', [RoomController::class, 'destroy']);
    Route::get('/leaderboard', [ScoreController::class, 'leaderboard']);

    Route::middleware('auth')->group(function () {
        Route::post('/scores', [ScoreController::class, 'store']);
        Route::get('/saves', [SaveController::class, 'index']);
        Route::get('/saves/{slot}', [SaveController::class, 'show']);
        Route::put('/saves/{slot}', [SaveController::class, 'update']);
        Route::delete('/saves/{slot}', [SaveController::class, 'destroy']);
    });
});
