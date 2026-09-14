<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Admin account from the environment
    |--------------------------------------------------------------------------
    |
    | `php artisan admin:sync` creates or updates this account and marks it as
    | an admin (the deploy script runs it after migrations). A user with this
    | email is treated as an admin even before the sync runs, so the account
    | can never be locked out of the admin section.
    |
    */

    'email' => env('ADMIN_EMAIL'),
    'password' => env('ADMIN_PASSWORD'),
    'name' => env('ADMIN_NAME', 'Admin'),

    /*
    |--------------------------------------------------------------------------
    | Device approval
    |--------------------------------------------------------------------------
    */

    'device_cookie' => 'bs_device',
    // a browser that never gets approved is forgotten after this long
    'device_pending_days' => 30,

];
