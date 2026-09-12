<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\SaveController;
use App\Http\Controllers\Api\ScoreController;
use Illuminate\Support\Facades\Route;

// Everything is rate-limited; auth endpoints more tightly (brute force), the rest per user/IP.
Route::middleware('throttle:10,1')->group(function () {
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
});

Route::middleware('throttle:60,1')->group(function () {
    Route::post('/rooms', [RoomController::class, 'store']);
    Route::get('/rooms/{code}', [RoomController::class, 'show']);
    Route::patch('/rooms/{code}', [RoomController::class, 'update']);
    Route::delete('/rooms/{code}', [RoomController::class, 'destroy']);
    Route::get('/leaderboard', [ScoreController::class, 'leaderboard']);
});

Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/scores', [ScoreController::class, 'store']);
    Route::get('/saves', [SaveController::class, 'index']);
    Route::get('/saves/{slot}', [SaveController::class, 'show']);
    Route::put('/saves/{slot}', [SaveController::class, 'update']);
    Route::delete('/saves/{slot}', [SaveController::class, 'destroy']);
});
