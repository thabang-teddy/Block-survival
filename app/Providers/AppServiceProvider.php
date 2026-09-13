<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // a WebRTC handshake is a burst of ~20 small messages per joining player
        RateLimiter::for('signal', fn (Request $request) => Limit::perMinute(240)->by($request->ip()));
    }
}
