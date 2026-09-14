<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('saves', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // client-chosen slot name, e.g. "main"
            $table->string('slot', 32);
            // gzipped JSON (world diff + inventories), base64 so it fits any driver
            $table->longText('payload');
            $table->unsignedInteger('size');
            $table->unsignedInteger('night')->default(0);
            $table->unsignedInteger('seconds')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'slot']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('saves');
    }
};
