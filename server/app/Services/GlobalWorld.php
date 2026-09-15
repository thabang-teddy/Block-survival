<?php

namespace App\Services;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Api\RoomController;
use App\Models\GlobalSeat;
use App\Models\Room;
use App\Models\RoomSignal;
use App\Models\User;
use App\Models\World;

/**
 * The shared global world is hosted by whoever is in it. `global_seats` is the queue of
 * players inside, in arrival order; the front of the queue hosts, the rest join their
 * room. A seat stays fresh while the host's room refresh vouches for it (or, once the
 * host is gone, while the player polls `claim`); stale seats are pruned on every look
 * at the queue — there is no scheduler on shared hosting.
 */
class GlobalWorld
{
    /** drop seats nobody has vouched for, and the rooms of hosts who no longer hold one */
    public function prune(): void
    {
        GlobalSeat::query()->stale()->delete();
        $seated = GlobalSeat::query()->pluck('user_id');
        $orphans = Room::query()->where('world_kind', World::GLOBAL)
            ->where(fn ($q) => $q->whereNull('user_id')->orWhereNotIn('user_id', $seated))
            ->get();
        foreach ($orphans as $room) {
            $this->closeRoom($room);
        }
    }

    /** the front of the queue: the fresh seat that arrived first */
    public function host(): ?GlobalSeat
    {
        return GlobalSeat::query()->fresh()->orderBy('id')->first();
    }

    public function isHost(User $user): bool
    {
        return $this->host()?->user_id === $user->id;
    }

    public function seatOf(User $user): ?GlobalSeat
    {
        return GlobalSeat::query()->where('user_id', $user->id)->first();
    }

    public function online(): int
    {
        return GlobalSeat::query()->fresh()->count();
    }

    /**
     * Enter from the lobby: a new seat at the back of the queue (an old one is dropped
     * first, which is what puts a returning host behind everyone else).
     *
     * @return array<string, mixed> the state the player should act on
     *
     * @throws GlobalWorldException when the world is full or the player already hosts it elsewhere
     */
    public function join(User $user): array
    {
        $this->prune();
        $mine = $this->seatOf($user);
        if ($mine?->room_code !== null && $this->liveRoom($mine->room_code) !== null) {
            throw new GlobalWorldException('You are already hosting the global world in another tab.', 409);
        }
        $others = GlobalSeat::query()->fresh()->where('user_id', '!=', $user->id)->count();
        if ($others >= RoomController::MAX_PLAYERS) {
            throw new GlobalWorldException('The global world is full right now — try again in a moment.', 409);
        }
        $mine?->delete();
        GlobalSeat::create(['user_id' => $user->id, 'last_seen_at' => now(), 'created_at' => now()]);

        return $this->state($user);
    }

    /**
     * A player whose host went away keeps their place and asks who hosts now. Touching
     * their seat is what keeps it fresh while there is no host to vouch for them.
     *
     * @return array<string, mixed>
     *
     * @throws GlobalWorldException when the player holds no seat any more
     */
    public function claim(User $user): array
    {
        $mine = $this->seatOf($user);
        if (! $mine) {
            throw new GlobalWorldException('You are not in the global world — enter it from the lobby.', 404);
        }
        $mine->update(['last_seen_at' => now()]);
        $this->prune();

        return $this->state($user);
    }

    /** give up the seat; a host's room goes with it */
    public function leave(User $user): void
    {
        $mine = $this->seatOf($user);
        if (! $mine) {
            return;
        }
        if ($mine->room_code !== null) {
            $room = Room::query()->where('code', $mine->room_code)->first();
            if ($room) {
                $this->closeRoom($room);
            }
        }
        $mine->delete();
    }

    /** the host opened its room: record it on the seat so the queue can hand it out */
    public function roomOpened(User $user, Room $room): void
    {
        // one global room at a time: an earlier room of this or any other host is dead
        foreach (Room::query()->where('world_kind', World::GLOBAL)->whereKeyNot($room->id)->get() as $old) {
            $this->closeRoom($old);
        }
        GlobalSeat::query()->where('user_id', $user->id)->update(['room_code' => $room->code, 'last_seen_at' => now()]);
    }

    /**
     * The host's periodic refresh vouches for everyone connected to it.
     *
     * @param  list<int>  $userIds
     */
    public function touch(User $host, array $userIds): void
    {
        GlobalSeat::query()->whereIn('user_id', [...$userIds, $host->id])->update(['last_seen_at' => now()]);
    }

    /**
     * What the player should do: open a room (`host`), connect to one (`client`), or
     * wait for the chosen host to open theirs (`pending`).
     *
     * @return array<string, mixed>
     */
    public function state(User $user): array
    {
        $host = $this->host();
        $online = $this->online();
        if ($host === null || $host->user_id === $user->id) {
            return ['status' => 'host', 'online' => $online];
        }
        $room = $host->room_code !== null ? $this->liveRoom($host->room_code) : null;
        if ($room !== null) {
            return ['status' => 'client', 'room' => $room->toPublic(), 'online' => $online];
        }

        return ['status' => 'pending', 'host_name' => $host->user?->name ?? 'Survivor', 'online' => $online];
    }

    /** @return array{online: int, host_name: string|null} what the lobby shows on the card */
    public function presence(): array
    {
        $host = $this->host();

        return ['online' => $this->online(), 'host_name' => $host?->user?->name];
    }

    /** wipe the shared world; refused while someone is hosting it */
    public function reset(): void
    {
        if ($this->host() !== null) {
            throw new GlobalWorldException('Someone is in the global world — reset it when it is empty.', 409);
        }
        GlobalSeat::query()->delete();
        World::query()->whereNull('user_id')->where('kind', World::GLOBAL)->delete();
    }

    private function liveRoom(string $code): ?Room
    {
        return Room::query()->live()->where('code', $code)->first();
    }

    private function closeRoom(Room $room): void
    {
        RoomSignal::query()->where('room_code', $room->code)->delete();
        $room->delete();
    }
}
