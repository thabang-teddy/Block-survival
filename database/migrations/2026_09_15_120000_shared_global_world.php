<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The global world becomes one shared save (`saves.user_id` null) hosted by whoever is in
 * it: `global_seats` is the queue of players currently inside, in arrival order — the
 * front of the queue hosts. Every player's private copy of the global world is dropped.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('saves')->where('kind', 'global')->delete();

        Schema::table('saves', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->change();
        });

        Schema::create('global_seats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            // the host's room, once it is open
            $table->string('room_code', 6)->nullable();
            $table->timestamp('last_seen_at');
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('global_seats');

        DB::table('saves')->whereNull('user_id')->delete();

        Schema::table('saves', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable(false)->change();
        });
    }
};
