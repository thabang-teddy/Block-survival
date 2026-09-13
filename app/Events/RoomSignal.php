<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * One WebRTC signalling message (offer / answer / ICE candidate) relayed to every
 * browser subscribed to the room's public channel; receivers filter on `to`.
 * The room code is the only secret, exactly as it is for joining.
 */
class RoomSignal implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  array<string, mixed>  $data
     */
    public function __construct(
        public readonly string $code,
        public readonly string $from,
        public readonly string $to,
        public readonly string $type,
        public readonly array $data,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('room.'.$this->code);
    }

    public function broadcastAs(): string
    {
        return 'signal';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return ['from' => $this->from, 'to' => $this->to, 'type' => $this->type, 'data' => $this->data];
    }
}
