<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // WebRTC signalling mailbox: peers POST offers/answers/candidates here
        // and poll for the ones addressed to them. Rows live as long as the
        // room's TTL and are swept when any room is opened or closed.
        Schema::create('room_signals', function (Blueprint $table) {
            $table->id();
            $table->string('room_code', 6);
            $table->string('from_peer', 64);
            $table->string('to_peer', 64);
            $table->string('type', 16);
            $table->text('data');
            $table->timestamp('created_at')->index();

            // the poll: WHERE room_code = ? AND to_peer = ? AND id > ? ORDER BY id
            $table->index(['room_code', 'to_peer', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_signals');
    }
};
