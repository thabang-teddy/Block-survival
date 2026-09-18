<?php

namespace App\Exceptions;

use RuntimeException;

/** the global world refused a player's request; `getCode()` is the HTTP status to answer with */
class GlobalWorldException extends RuntimeException
{
    public function __construct(string $message, int $status)
    {
        parent::__construct($message, $status);
    }
}
