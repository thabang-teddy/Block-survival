<?php

use App\Http\Controllers\Api\HostController;
use App\Http\Middleware\EnforceMaintenanceToggle;
use Illuminate\Support\Facades\Route;

// The host PC's API (docs/pc-host-research.md §5.1). Loaded as the `api` route file,
// so there is no session, cookie or CSRF here: the host token is the only credential,
// and it opens nothing but these routes.
Route::prefix('host')->middleware([EnforceMaintenanceToggle::class, 'host', 'throttle:host'])->group(function () {
    Route::post('/heartbeat', [HostController::class, 'heartbeat']);
    Route::get('/signals', [HostController::class, 'signals']);
    Route::post('/signal', [HostController::class, 'signal']);
    Route::get('/world', [HostController::class, 'showWorld']);
    Route::put('/world', [HostController::class, 'storeWorld']);
    Route::post('/scores', [HostController::class, 'scores']);
    Route::post('/access', [HostController::class, 'access']);
    Route::get('/ice-servers', [HostController::class, 'iceServers']);
});
