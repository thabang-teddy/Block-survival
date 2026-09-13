<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use DateTimeZone;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Admin form for the operating hours (see App\Support\LoginWindow). */
class LoginWindowController extends Controller
{
    private const TIME_RULE = 'regex:/^([01]\d|2[0-3]):[0-5]\d$/';

    public function update(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'start' => ['required', 'string', self::TIME_RULE],
            'end' => ['required', 'string', self::TIME_RULE],
            'days' => ['present', 'array', 'max:7'],
            'days.*' => ['integer', 'between:0,6', 'distinct'],
            'timezone' => ['required', 'string', Rule::in(DateTimeZone::listIdentifiers())],
        ]);

        Setting::setMany([
            'login_window_enabled' => $data['enabled'] ? '1' : '0',
            'login_window_start' => $data['start'],
            'login_window_end' => $data['end'],
            'login_window_days' => implode(',', array_map('intval', $data['days'])),
            'login_window_timezone' => $data['timezone'],
        ]);

        return back()->with('status', 'Operating hours saved.');
    }
}
