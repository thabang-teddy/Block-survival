<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Many host PCs, one global world each (docs/pc-host-research.md §8). Every host key
 * (`game_hosts` row) now owns a global world: its save (`saves.game_host_id`), its seat
 * list (`global_seats.game_host_id`) and its map seed. Browsers no longer host global
 * worlds, so the seat queue's `room_code` goes.
 *
 * The existing global save moves to the first host with the classic seed; with no host
 * yet it stays unowned until the first host key is created (GameHost::register).
 */
return new class extends Migration
{
    /** the classic island (ISLAND_LARGE.seed in resources/js/world/islandGen.ts) */
    private const CLASSIC_SEED = 11;

    public function up(): void
    {
        Schema::table('game_hosts', function (Blueprint $table) {
            $table->unsignedInteger('seed')->default(self::CLASSIC_SEED)->after('name');
        });

        Schema::table('saves', function (Blueprint $table) {
            $table->foreignId('game_host_id')->nullable()->after('user_id')->constrained()->cascadeOnDelete();
        });

        // seats are live presence, not data: whoever is inside enters again from the lobby
        DB::table('global_seats')->delete();
        Schema::table('global_seats', function (Blueprint $table) {
            $table->dropColumn('room_code');
            $table->foreignId('game_host_id')->after('user_id')->constrained()->cascadeOnDelete();
        });

        $first = DB::table('game_hosts')->orderBy('id')->value('id');
        if ($first !== null) {
            DB::table('saves')->whereNull('user_id')->where('kind', 'global')->update(['game_host_id' => $first]);
        }
        // browsers' global rooms are dead: only host PCs open them now
        $codes = DB::table('rooms')->where('world_kind', 'global')->whereNotNull('user_id')->pluck('code');
        DB::table('room_signals')->whereIn('room_code', $codes)->delete();
        DB::table('rooms')->whereIn('code', $codes)->delete();
    }

    public function down(): void
    {
        DB::table('global_seats')->delete();
        Schema::table('global_seats', function (Blueprint $table) {
            $table->dropConstrainedForeignId('game_host_id');
            $table->string('room_code', 6)->nullable();
        });

        // one global world again: keep the first host's
        $first = DB::table('game_hosts')->orderBy('id')->value('id');
        DB::table('saves')->whereNull('user_id')->where('kind', 'global')
            ->where(fn ($q) => $q->whereNull('game_host_id')->orWhere('game_host_id', '!=', $first))
            ->delete();
        Schema::table('saves', function (Blueprint $table) {
            $table->dropConstrainedForeignId('game_host_id');
        });

        Schema::table('game_hosts', function (Blueprint $table) {
            $table->dropColumn('seed');
        });
    }
};
