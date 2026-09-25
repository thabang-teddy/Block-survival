<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'score', 'nights', 'kills', 'deaths', 'seconds'])]
class Score extends Model
{
    public const PER_NIGHT = 100;

    public const PER_KILL = 5;

    /** one run, as a player or the host PC reports it */
    public const RUN_RULES = [
        'nights' => ['required', 'integer', 'min:0', 'max:1000'],
        'kills' => ['required', 'integer', 'min:0', 'max:100000'],
        'deaths' => ['required', 'integer', 'min:0', 'max:100000'],
        'seconds' => ['required', 'integer', 'min:0', 'max:604800'],
    ];

    /**
     * Record a run. The score is computed here from nights and kills, so whoever reports
     * the run cannot post an arbitrary number.
     *
     * @param  array{nights: int, kills: int, deaths: int, seconds: int}  $run
     */
    public static function record(User $user, array $run): self
    {
        return $user->scores()->create([
            'nights' => $run['nights'],
            'kills' => $run['kills'],
            'deaths' => $run['deaths'],
            'seconds' => $run['seconds'],
            'score' => $run['nights'] * self::PER_NIGHT + $run['kills'] * self::PER_KILL,
        ]);
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
