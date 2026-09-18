<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** v3 saves carry every player who has been in the world; the lobby shows how many (issue #13) */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('saves', function (Blueprint $table) {
            $table->unsignedSmallInteger('players')->default(1)->after('seconds');
        });
    }

    public function down(): void
    {
        Schema::table('saves', function (Blueprint $table) {
            $table->dropColumn('players');
        });
    }
};
