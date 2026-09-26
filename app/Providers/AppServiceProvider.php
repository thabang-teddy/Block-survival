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
        // signalling is polled: a host at 500 ms plus a joining client at 500 ms
        // behind one NAT is ~240 req/min, on top of the ~20 POSTs of a handshake
        RateLimiter::for('signal', fn (Request $request) => Limit::perMinute(600)->by($request->ip()));
        // the host PC: a heartbeat every 15 s, the mailbox at 1–2 Hz, saves, scores and
        // access checks — 60–150 a minute in normal play
        RateLimiter::for('host', fn (Request $request) => Limit::perMinute(300)->by('host:'.$request->ip()));
    }
}
