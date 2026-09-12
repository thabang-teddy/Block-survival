<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['user_id', 'slot', 'payload', 'size', 'night', 'seconds'])]
#[Hidden(['payload'])]
class Save extends Model
{
    /** gzipped payload limit (bytes) */
    public const MAX_BYTES = 2 * 1024 * 1024;
}
