<?php

namespace App\Services;

use App\Exceptions\GlobalWorldException;
use App\Http\Controllers\Api\RoomController;
use App\Models\GameHost;
use App\Models\GlobalSeat;
use App\Models\Room;
use App\Models\RoomSignal;
use App\Models\User;
use App\Models\World;
use App\Support\GameRules;

/**
 * The shared global world. When a host PC holds it (docs/pc-host-research.md), the PC
 * hosts and every seat is a joiner; while the PC is paused the world waits for it. Else
 * the world is hosted by whoever is in it: `global_seats` is the queue of players inside,
 * in arrival order; the front of the queue hosts, the rest join their room. A seat stays
 * fresh while the host vouches for it (or, while there is no host, while the player polls
 * `claim`); stale seats are pruned on every look at the queue — there is no scheduler on
 * shared hosting.
 */
class GlobalWorld
{
    /** the enabled host PC, if there is one */
    public function pc(): ?GameHost
    {
        $pc = GameHost::current();

        return $pc?->enabled ? $pc : null;
    }

    /** the PC is online or paused: no browser may host the global world */
    public function pcHolds(): bool
    {
        return $this->pc()?->holdsWorld() ?? false;
    }

    /** drop seats nobody has vouched for, and the rooms of hosts who no longer hold one */
    public function prune(): void
    {
        GlobalSeat::query()->stale()->delete();
        $seated = GlobalSeat::query()->pluck('user_id');
        $pc = $this->pc();
        $pcRoom = $pc?->holdsWorld() ? $pc->room_code : null;
        $orphans = Room::query()->where('world_kind', World::GLOBAL)
            ->when($pcRoom !== null, fn ($q) => $q->where('code', '!=', $pcRoom))
            ->where(fn ($q) => $q->whereNull('user_id')->orWhereNotIn('user_id', $seated))
            ->get();
        foreach ($orphans as $room) {
            $this->closeRoom($room);
            if ($room->user_id !== null) {
                $this->pcTakesBack();
            }
        }
    }

    /** the browser at the front of the queue: the fresh seat that arrived first — none while the PC holds the world */
    public function host(): ?GlobalSeat
    {
        if ($this->pcHolds()) {
            return null;
        }

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
     * A player whose host went away (or who waits on a paused PC) keeps their place and
     * asks who hosts now. Touching their seat is what keeps it fresh while there is no
     * host to vouch for them.
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
     * The host's refresh is its own sign of life. A tab in the background gets no frames,
     * so no heartbeat, and its seat goes stale — but until someone sweeps the queue that
     * seat is still there, and the host asking again is what proves it is back. False once
     * the queue has moved on without them (the seat was swept, or the PC holds the world).
     */
    public function heartbeat(User $host): bool
    {
        GlobalSeat::query()->where('user_id', $host->id)->update(['last_seen_at' => now()]);

        return $this->isHost($host);
    }

    /**
     * A browser's global room closed: its host has left the world, whoever's session sent
     * the request. A PC standing by takes the world back now.
     */
    public function roomClosed(Room $room): void
    {
        $host = $room->user_id !== null ? User::find($room->user_id) : null;
        if ($host) {
            $this->leave($host);
        }
        $this->pcTakesBack();
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
     * What the player should do: open a room (`host`), connect to one (`client`), wait
     * for the chosen host to open theirs (`pending`), or wait for the paused PC
     * (`paused`). `host` says who runs the world: the PC or a browser.
     *
     * @return array<string, mixed>
     */
    public function state(User $user): array
    {
        $online = $this->online();
        $pc = $this->pc();
        if ($pc?->holdsWorld()) {
            $room = $pc->state() === GameHost::ONLINE && $pc->room_code !== null
                ? Room::query()->hosting()->where('code', $pc->room_code)->first()
                : null;

            return $room !== null
                ? ['status' => 'client', 'host' => 'pc', 'room' => $room->toPublic(), 'online' => $online]
                : ['status' => 'paused', 'host' => 'pc', 'host_name' => $pc->name, 'online' => $online];
        }
        $host = $this->host();
        if ($host === null || $host->user_id === $user->id) {
            return ['status' => 'host', 'host' => 'browser', 'online' => $online];
        }
        $room = $host->room_code !== null ? $this->liveRoom($host->room_code) : null;
        if ($room !== null) {
            return ['status' => 'client', 'host' => 'browser', 'room' => $room->toPublic(), 'online' => $online];
        }

        return ['status' => 'pending', 'host' => 'browser', 'host_name' => $host->user?->name ?? 'Survivor', 'online' => $online];
    }

    /** @return array{online: int, host_name: string|null, paused: bool} what the lobby shows on the card */
    public function presence(): array
    {
        $pc = $this->pc();
        if ($pc?->holdsWorld()) {
            return ['online' => $this->online(), 'host_name' => $pc->name, 'paused' => $pc->state() === GameHost::PAUSED];
        }
        $host = $this->host();

        return ['online' => $this->online(), 'host_name' => $host?->user?->name, 'paused' => false];
    }

    /**
     * Wipe the shared world; refused while someone is in it. A PC holding the world is
     * told to start over on its next heartbeat.
     */
    public function reset(): void
    {
        if ($this->pcHolds()) {
            if ($this->online() > 0) {
                throw new GlobalWorldException('Someone is in the global world — reset it when it is empty.', 409);
            }
            $this->pc()->queueCommand(GameHost::COMMAND_RESET);
        } elseif ($this->host() !== null) {
            throw new GlobalWorldException('Someone is in the global world — reset it when it is empty.', 409);
        }
        GlobalSeat::query()->delete();
        World::query()->whereNull('user_id')->where('kind', World::GLOBAL)->delete();
    }

    // ================================================================ the host PC

    /**
     * One heartbeat from the PC (every 15 s). `going: offline` is a clean shutdown and
     * hands the world to the browsers; `going: restart` (Windows stopping the service)
     * keeps players paused until the PC is back. Otherwise the PC holds the world — unless
     * it was released or shut down and browsers are still playing, in which case it
     * stands by until they are done.
     *
     * @param  array{version: string, peer_id: string, going?: string, room?: array{code: string, players: int, user_ids?: list<int>}, stats?: array<string, mixed>}  $data
     * @return array<string, mixed> the reply the PC acts on
     *
     * @throws GlobalWorldException when the PC's room code belongs to someone else's room
     */
    public function pcHeartbeat(GameHost $pc, array $data): array
    {
        $pc->fill([
            'version' => $data['version'],
            'peer_id' => $data['peer_id'],
            'last_seen_at' => now(),
            'stats' => $data['stats'] ?? $pc->stats,
        ]);
        $going = $data['going'] ?? null;
        if ($going === 'offline') {
            $pc->fill(['offline_at' => now(), 'paused_at' => null, 'players' => 0])->save();
            $this->closePcRoom($pc);

            return ['state' => GameHost::OFFLINE];
        }
        if ($going === 'restart') {
            $pc->fill(['paused_at' => now()])->save();

            return ['state' => $pc->state()];
        }

        $pc->paused_at = null;
        if ($pc->offline_at !== null) {
            // browsers are playing: they keep the world until they are done with it
            if ($this->online() > 0) {
                $pc->save();
                $this->closePcRoom($pc);

                return ['state' => 'standby'];
            }
            $pc->offline_at = null;
        }
        $room = $data['room'];
        $taken = Room::query()->live()->where('code', $room['code'])->where('host_peer_id', '!=', $data['peer_id'])->exists();
        if ($taken && $pc->room_code !== $room['code']) {
            $pc->save();
            throw new GlobalWorldException('That room code is in use — pick another.', 409);
        }
        $pc->fill(['room_code' => $room['code'], 'players' => $room['players']])->save();
        $row = $this->openPcRoom($pc, $room['players']);
        GlobalSeat::query()->whereIn('user_id', $room['user_ids'] ?? [])->update(['last_seen_at' => now()]);
        // no scheduler on shared hosting: the PC's heartbeat sweeps stale mail too
        RoomSignal::pruneStale();

        return [
            'state' => GameHost::ONLINE,
            'room' => $row->toPublic(),
            'rules' => GameRules::fromSettings()->toArray(),
            'commands' => $this->takePcCommands($pc),
        ];
    }

    /** the admin's "release to browsers": the world goes back to the browser queue until the PC takes it back */
    public function releasePc(): void
    {
        $pc = $this->pc();
        if (! $pc) {
            return;
        }
        $pc->update(['offline_at' => now(), 'players' => 0]);
        $this->closePcRoom($pc);
    }

    /** the PC's room row, while it holds the world and the room is being refreshed */
    public function pcRoom(): ?Room
    {
        $pc = $this->pc();
        if (! $pc?->holdsWorld() || $pc->room_code === null) {
            return null;
        }

        return Room::query()->live()->where('code', $pc->room_code)->first();
    }

    /** a PC standing by (released or shut down, but running again) takes the world back */
    private function pcTakesBack(): void
    {
        $pc = $this->pc();
        if ($pc?->isStandingBy()) {
            $pc->update(['offline_at' => null]);
        }
    }

    private function openPcRoom(GameHost $pc, int $players): Room
    {
        $room = Room::query()->updateOrCreate(
            ['code' => $pc->room_code],
            [
                'host_peer_id' => $pc->peer_id,
                'host_name' => $pc->name,
                'world_kind' => World::GLOBAL,
                'user_id' => null,
                'players' => $players,
                'expires_at' => now()->addHours(Room::TTL_HOURS),
                'last_seen_at' => now(),
            ],
        );
        // the PC holds the world: a browser's room from before is dead
        foreach (Room::query()->where('world_kind', World::GLOBAL)->whereKeyNot($room->id)->get() as $old) {
            $this->closeRoom($old);
        }
        GlobalSeat::query()->whereNotNull('room_code')->update(['room_code' => null]);

        return $room;
    }

    private function closePcRoom(GameHost $pc): void
    {
        if ($pc->room_code === null) {
            return;
        }
        $room = Room::query()->where('code', $pc->room_code)->whereNull('user_id')->first();
        if ($room) {
            $this->closeRoom($room);
        }
        $pc->update(['room_code' => null]);
    }

    /** @return list<string> */
    private function takePcCommands(GameHost $pc): array
    {
        $commands = $pc->takeCommands();
        $pc->save();

        return $commands;
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
