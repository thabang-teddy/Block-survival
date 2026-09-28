<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Cloud saves had named slots; now every player has exactly one world. */
return new class extends Migration
{
    public function up(): void
    {
        // keep only the most recently updated save per player before making user_id unique
        $keep = DB::table('saves')->selectRaw('MAX(id) as id')->groupBy('user_id')->pluck('id');
        DB::table('saves')->whereNotIn('id', $keep)->delete();

        Schema::table('saves', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'slot']);
        });
        Schema::table('saves', function (Blueprint $table) {
            $table->dropColumn('slot');
            $table->unique('user_id');
        });
    }

    public function down(): void
    {
        Schema::table('saves', function (Blueprint $table) {
            $table->dropUnique(['user_id']);
        });
        Schema::table('saves', function (Blueprint $table) {
            $table->string('slot', 32)->default('main');
            $table->unique(['user_id', 'slot']);
        });
    }
};
