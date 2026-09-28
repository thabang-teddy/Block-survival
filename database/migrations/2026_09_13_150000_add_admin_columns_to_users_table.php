<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_admin')->default(false)->after('password');
            // a disabled account keeps its data but cannot sign in
            $table->boolean('is_disabled')->default(false)->after('is_admin');
            $table->timestamp('last_login_at')->nullable()->after('is_disabled');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['is_admin', 'is_disabled', 'last_login_at']);
        });
    }
};
