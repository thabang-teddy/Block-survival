<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Issue #5: every player has their own world (random seed) and their own save of the
 * shared global world (the classic seed); rooms say which world they run, and joining
 * one takes an invitation from the host.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('saves', function (Blueprint $table) {
            $table->string('kind', 8)->default('own')->after('user_id');
        });
        Schema::table('saves', function (Blueprint $table) {
            $table->dropUnique(['user_id']);
        });
        Schema::table('saves', function (Blueprint $table) {
            $table->unique(['user_id', 'kind']);
        });

        Schema::table('rooms', function (Blueprint $table) {
            $table->string('world_kind', 8)->default('own')->after('host_name');
        });

        Schema::create('room_invites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained()->cascadeOnDelete();
            $table->foreignId('from_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('to_user_id')->constrained('users')->cascadeOnDelete();
            // pending | accepted | declined
            $table->string('status', 8)->default('pending');
            $table->timestamps();
            $table->unique(['room_id', 'to_user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_invites');

        Schema::table('rooms', function (Blueprint $table) {
            $table->dropColumn('world_kind');
        });

        // keep the player's own world when going back to one save per user
        Schema::table('saves', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'kind']);
        });
        \Illuminate\Support\Facades\DB::table('saves')->where('kind', '!=', 'own')->delete();
        Schema::table('saves', function (Blueprint $table) {
            $table->dropColumn('kind');
        });
        Schema::table('saves', function (Blueprint $table) {
            $table->unique('user_id');
        });
    }
};
