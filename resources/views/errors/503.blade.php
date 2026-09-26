<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="60">
    <title>Down for maintenance · {{ config('app.name') }}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/favicon.ico" sizes="any">
    {{-- self-contained on purpose: no Vite build, so it renders mid-deploy --}}
    <style>
        :root {
            --backdrop: #dfe5ec;
            --card: #ffffff;
            --ink: #3b3b3b;
            --muted: #7a7a7a;
            --rule: #ebeef1;
            --blue: #1d9bf0;
            --blue-light: #a9daf7;
            --blue-mid: #55b9f3;
            --blue-dark: #0e5fa8;
            --green: #23d660;
            --green-light: #61ee87;
            --green-mid: #37e070;
            --green-dark: #128d3c;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }
        body {
            background: var(--backdrop);
            color: var(--ink);
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        .card {
            min-height: 100vh;
            min-height: 100dvh;
            background: var(--card);
            display: flex;
            flex-direction: column;
        }
        .brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 36px 24px 0;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: -.01em;
        }
        .brand svg { width: 26px; height: 26px; }
        main {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 40px 24px;
            text-align: center;
            overflow: hidden; /* cables overshoot the scene to reach the page edges */
        }
        h1 {
            margin: 0 auto 14px;
            max-width: 420px;
            font-size: clamp(26px, 4.4vw, 32px);
            line-height: 1.15;
            font-weight: 700;
            letter-spacing: -.02em;
        }
        p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--muted); }
        .scene { display: block; width: 100%; max-width: 690px; height: auto; margin: 44px auto 0; overflow: visible; }
        footer {
            border-top: 1px solid var(--rule);
            padding: 16px 24px 20px;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 6px 16px;
            font-size: 12px;
            color: var(--muted);
        }
        footer a { color: var(--ink); text-decoration: none; }
        footer a:hover { text-decoration: underline; }
        footer b { font-weight: 500; color: var(--ink); }
    </style>
</head>
<body>
    <div class="card">
        <div class="brand">
            <svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="38,11.5 54.45,21 38,30.5 21.55,21" fill="#a8a8a0"/><polygon points="21.55,21 38,30.5 38,49.5 21.55,40" fill="#6e6e68"/><polygon points="38,30.5 54.45,21 54.45,40 38,49.5" fill="#8a8a84"/><polygon points="26,22 42.45,31.5 26,41 9.55,31.5" fill="#e39a55"/><polygon points="9.55,31.5 26,41 26,60 9.55,50.5" fill="#8a5a2c"/><polygon points="26,41 42.45,31.5 42.45,50.5 26,60" fill="#b8743a"/><polygon points="9.55,38.72 26,48.22 26,52.78 9.55,43.28" fill="#4a3220"/><polygon points="26,48.22 42.45,38.72 42.45,43.28 26,52.78" fill="#4a3220"/><polygon points="26,22 42.45,31.5 26,41 9.55,31.5" fill="none" stroke="#4a3220" stroke-width="2.2" stroke-linejoin="round"/><line x1="26" y1="41" x2="26" y2="60" stroke="#4a3220" stroke-width="2.2"/></svg>
            <span>{{ config('app.name') }}</span>
        </div>

        <main>
            <h1>The site is currently down&nbsp;for maintenance</h1>
            <p>We apologize for any inconvenience caused.<br>We&rsquo;re almost done.</p>

            {{-- two unplugged connectors: blue plug on the left, green socket on the right --}}
            <svg class="scene" viewBox="0 0 690 120" role="img" aria-label="An unplugged cable">
                <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="18">
                    <path d="M-2000 20 H150 C170 20 170 62 190 62 H226" stroke="var(--blue-light)"/>
                    <path d="M2690 20 H540 C520 20 520 62 500 62 H464" stroke="var(--green)"/>
                </g>
                <g fill="none" stroke-linecap="round" stroke-width="5">
                    <path d="M-2000 14 H150 C166 14 168 30 172 40" stroke="var(--blue-mid)"/>
                    <path d="M2690 14 H540 C524 14 522 30 518 40" stroke="var(--green-light)"/>
                </g>

                {{-- blue plug --}}
                <rect x="224" y="38" width="88" height="48" rx="8" fill="var(--blue)"/>
                <rect x="240" y="38" width="16" height="16" fill="var(--blue-dark)"/>
                <rect x="256" y="54" width="16" height="16" fill="var(--blue-dark)"/>
                <rect x="272" y="38" width="16" height="16" fill="var(--blue-mid)"/>
                <rect x="288" y="70" width="16" height="16" fill="var(--blue-light)"/>
                <rect x="240" y="70" width="16" height="16" fill="var(--blue-light)"/>
                <rect x="272" y="70" width="16" height="16" fill="var(--blue-dark)"/>
                <rect x="312" y="47" width="30" height="9" rx="4" fill="var(--blue-dark)"/>
                <rect x="312" y="68" width="30" height="9" rx="4" fill="var(--blue-dark)"/>

                {{-- green socket --}}
                <rect x="378" y="38" width="88" height="48" rx="8" fill="var(--green)"/>
                <rect x="418" y="38" width="16" height="16" fill="var(--green-light)"/>
                <rect x="402" y="54" width="16" height="16" fill="var(--green-mid)"/>
                <rect x="434" y="54" width="16" height="16" fill="var(--green-dark)"/>
                <rect x="418" y="70" width="16" height="16" fill="var(--green-light)"/>
                <rect x="378" y="47" width="24" height="9" rx="4" fill="var(--green-dark)"/>
                <rect x="378" y="68" width="24" height="9" rx="4" fill="var(--green-dark)"/>

                {{-- sparks in the gap --}}
                <g stroke-width="5" stroke-linecap="round" fill="none">
                    <path d="M347 30 L353 41" stroke="var(--blue-light)"/>
                    <path d="M346 62 H356" stroke="var(--blue-light)"/>
                    <path d="M347 94 L353 83" stroke="var(--blue-light)"/>
                    <path d="M373 30 L367 41" stroke="var(--green-light)"/>
                    <path d="M374 62 H364" stroke="var(--green-light)"/>
                    <path d="M373 94 L367 83" stroke="var(--green-light)"/>
                </g>
            </svg>
        </main>

        <footer>
            @if ($email = config('app.maintenance.support_email'))
                <span>You can contact us:</span>
                <span><b>Email:</b> <a href="mailto:{{ $email }}">{{ $email }}</a></span>
            @else
                <span>Back shortly &mdash; this page refreshes itself.</span>
            @endif
        </footer>
    </div>
</body>
</html>
