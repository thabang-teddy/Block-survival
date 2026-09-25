<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A PC at home that hosts the global world (docs/pc-host-research.md §5.1). It signs in
 * with a host token (only its hash is kept) and sends a heartbeat every 15 s; its state
 * (online, paused, offline) is derived from these columns. Offers in the mailbox now say
 * who posted them, so the PC never has to trust what a client claims about itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_hosts', function (Blueprint $table) {
            $table->id();
            $table->string('name', 16);
            // sha256 of the bearer token
            $table->string('token_hash', 64)->unique();
            $table->string('peer_id', 64)->nullable();
            $table->string('version', 32)->nullable();
            // the global world's room while the PC holds it
            $table->string('room_code', 6)->nullable();
            $table->unsignedTinyInteger('players')->default(0);
            $table->timestamp('last_seen_at')->nullable();
            $table->boolean('enabled')->default(true);
            // set by a clean shutdown or the admin's release; cleared when the PC takes the world back
            $table->timestamp('offline_at')->nullable();
            // set by `going: restart` (a service stop): paused until the next heartbeat
            $table->timestamp('paused_at')->nullable();
            // commands waiting for the next heartbeat, e.g. ["reset"]
            $table->json('commands')->nullable();
            // connection types and ICE failures the PC reports
            $table->json('stats')->nullable();
            $table->timestamps();
        });

        Schema::table('room_signals', function (Blueprint $table) {
            $table->foreignId('from_user_id')->nullable()->after('to_peer');
            $table->foreignId('from_device_id')->nullable()->after('from_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('room_signals', function (Blueprint $table) {
            $table->dropColumn(['from_user_id', 'from_device_id']);
        });
        Schema::dropIfExists('game_hosts');
    }
};
