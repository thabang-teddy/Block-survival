<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A room is *hosting* only while its host has refreshed it within the last 45 s; the
 * 2-hour `expires_at` stays for sweeping old rows (docs/pc-host-research.md §5.5).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rooms', function (Blueprint $table) {
            $table->timestamp('last_seen_at')->nullable()->index()->after('players');
        });
        // the last refresh of a room that is already open is its last update
        DB::table('rooms')->update(['last_seen_at' => DB::raw('updated_at')]);
    }

    public function down(): void
    {
        Schema::table('rooms', function (Blueprint $table) {
            $table->dropIndex(['last_seen_at']);
            $table->dropColumn('last_seen_at');
        });
    }
};
