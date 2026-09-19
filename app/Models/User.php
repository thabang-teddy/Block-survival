<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'is_admin', 'is_disabled', 'last_login_at'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'is_disabled' => 'boolean',
        ];
    }

    /** the account named by ADMIN_EMAIL is always an admin, so it cannot lock itself out */
    public function isEnvAdmin(): bool
    {
        $email = config('admin.email');

        return is_string($email) && $email !== '' && strcasecmp($email, $this->email) === 0;
    }

    public function isAdmin(): bool
    {
        return $this->is_admin || $this->isEnvAdmin();
    }

    /** @return HasMany<Score, $this> */
    public function scores(): HasMany
    {
        return $this->hasMany(Score::class);
    }

    /** @return HasMany<World, $this> the player's own world and their copy of the global one */
    public function worlds(): HasMany
    {
        return $this->hasMany(World::class);
    }

    /** @return HasOne<World, $this> the player's own world (the global world has no owner) */
    public function world(): HasOne
    {
        return $this->hasOne(World::class)->where('kind', World::OWN);
    }

    /** @return array{own: array<string, mixed>|null, global: array<string, mixed>|null} the player's own world and the shared global one */
    public function worldsMeta(): array
    {
        return [
            World::OWN => $this->world()->first()?->meta(),
            World::GLOBAL => World::global()?->meta(),
        ];
    }

    /** @return HasMany<Device, $this> */
    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }
}
