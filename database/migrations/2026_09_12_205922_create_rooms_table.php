<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rooms', function (Blueprint $table) {
            $table->id();
            $table->string('code', 6)->unique();
            // the host's PeerJS id; clients resolve the code to this to connect
            $table->string('host_peer_id', 128);
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('host_name', 16);
            $table->unsignedTinyInteger('players')->default(1);
            $table->timestamp('expires_at')->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rooms');
    }
};
