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
 * The global worlds (docs/pc-host-research.md §8). Each host key is one world, run by a
 * PC: only while that PC is online can players get in, and while it is paused they wait
 * for it. Browsers never host a global world. A player holds at most one seat — they are
 * in one world at a time; the PC's heartbeat vouches for everyone connected to it, and a
 * player waiting on a paused PC keeps their seat by asking (`claim`). Stale seats are
 * pruned on every look — there is no scheduler on shared hosting.
 */
class GlobalWorld
{
    public const OFFLINE_MESSAGE = 'This world is offline — its host PC isn\'t running.';

    /**
     * Every enabled world, for the lobby: offline ones too, greyed out.
     *
     * @return list<array<string, mixed>>
     */
    public function worlds(): array
    {
        GlobalSeat::query()->stale()->delete();
        $online = GlobalSeat::query()->fresh()->selectRaw('game_host_id, count(*) as n')->groupBy('game_host_id')->pluck('n', 'game_host_id');

        return GameHost::query()->where('enabled', true)->orderBy('id')->with('world')->get()
            ->map(fn (GameHost $pc) => [
                'id' => $pc->id,
                'name' => $pc->name,
                'seed' => $pc->seed,
                'state' => $pc->state(),
                'online' => (int) ($online[$pc->id] ?? 0),
                'save' => $pc->world?->meta(),
            ])->values()->all();
    }

    /** the enabled host key with this id */
    public function find(int $id): ?GameHost
    {
        return GameHost::query()->whereKey($id)->where('enabled', true)->first();
    }

    /** the first open world, else the first enabled one: where a client that names none goes */
    public function defaultWorld(): ?GameHost
    {
        $enabled = GameHost::query()->where('enabled', true)->orderBy('id')->get();

        return $enabled->first(fn (GameHost $pc) => $pc->isOpen()) ?? $enabled->first();
    }

    public function seatOf(User $user): ?GlobalSeat
    {
        return GlobalSeat::query()->where('user_id', $user->id)->first();
    }

    /** players inside this world right now */
    public function online(GameHost $pc): int
    {
        return $pc->seats()->fresh()->count();
    }

    /**
     * Enter a world from the lobby. A seat in another world is given up first.
     *
     * @return array<string, mixed> the state the player should act on
     *
     * @throws GlobalWorldException when the world is offline or full
     */
    public function join(User $user, GameHost $pc): array
    {
        GlobalSeat::query()->stale()->delete();
        if (! $pc->enabled || ! $pc->isOpen()) {
            throw new GlobalWorldException(self::OFFLINE_MESSAGE, 409);
        }
        $others = $pc->seats()->fresh()->where('user_id', '!=', $user->id)->count();
        if ($others >= RoomController::MAX_PLAYERS) {
            throw new GlobalWorldException('This world is full right now — try again in a moment.', 409);
        }
        GlobalSeat::query()->where('user_id', $user->id)->delete();
        GlobalSeat::create(['user_id' => $user->id, 'game_host_id' => $pc->id, 'last_seen_at' => now(), 'created_at' => now()]);

        return $this->state($user);
    }

    /**
     * A player whose link dropped, or who waits on a paused PC, keeps their seat and
     * asks where to go. Asking is what keeps the seat fresh while the PC cannot vouch.
     *
     * @return array<string, mixed>
     *
     * @throws GlobalWorldException when the player holds no seat any more
     */
    public function claim(User $user): array
    {
        $mine = $this->seatOf($user);
        if (! $mine) {
            throw new GlobalWorldException('You are not in a global world — enter one from the lobby.', 404);
        }
        $mine->update(['last_seen_at' => now()]);

        return $this->state($user);
    }

    public function leave(User $user): void
    {
        GlobalSeat::query()->where('user_id', $user->id)->delete();
    }

    /**
     * What the seated player should do: connect to the PC's room (`client`), wait for
     * the paused PC (`paused`), or give up — the world went offline (`offline`, and the
     * seat goes with it).
     *
     * @return array<string, mixed>
     */
    public function state(User $user): array
    {
        $seat = $this->seatOf($user);
        $pc = $seat?->host;
        if ($pc === null || ! $pc->enabled || ! $pc->isOpen()) {
            $seat?->delete();

            return ['status' => 'offline', 'host' => 'pc', 'message' => self::OFFLINE_MESSAGE];
        }
        $base = ['host' => 'pc', 'world' => $pc->id, 'host_name' => $pc->name, 'online' => $this->online($pc)];
        $room = $this->pcRoom($pc);

        return $room !== null
            ? ['status' => 'client', 'room' => $room->toPublic(), ...$base]
            : ['status' => 'paused', ...$base];
    }

    /**
     * Wipe a world; refused while someone is in it. A running PC is told to start over
     * on its next heartbeat.
     *
     * @throws GlobalWorldException when players are inside
     */
    public function reset(GameHost $pc): void
    {
        GlobalSeat::query()->stale()->delete();
        if ($this->online($pc) > 0) {
            throw new GlobalWorldException('Someone is in this world — reset it when it is empty.', 409);
        }
        if ($pc->isOpen()) {
            $pc->queueCommand(GameHost::COMMAND_RESET);
        }
        World::global($pc)?->delete();
    }

    // ================================================================ the host PC

    /**
     * One heartbeat from a PC (every 15 s). `going: offline` is a clean shutdown: the
     * world closes and nobody can enter until it runs again. `going: restart` (Windows
     * stopping the service) keeps players paused until the PC is back. Anything else
     * means the PC runs the world, and the reply carries its seed, rules and commands.
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
            $pc->seats()->delete();

            return ['state' => GameHost::OFFLINE];
        }
        if ($going === 'restart') {
            $pc->fill(['paused_at' => now()])->save();

            return ['state' => $pc->state()];
        }

        $pc->fill(['paused_at' => null, 'offline_at' => null]);
        $room = $data['room'];
        $taken = Room::query()->live()->where('code', $room['code'])->where('host_peer_id', '!=', $data['peer_id'])->exists();
        if ($taken && $pc->room_code !== $room['code']) {
            $pc->save();
            throw new GlobalWorldException('That room code is in use — pick another.', 409);
        }
        if ($pc->room_code !== null && $pc->room_code !== $room['code']) {
            $this->closePcRoom($pc);
        }
        $pc->fill(['room_code' => $room['code'], 'players' => $room['players']])->save();
        $row = $this->openPcRoom($pc, $room['players']);
        $pc->seats()->whereIn('user_id', $room['user_ids'] ?? [])->update(['last_seen_at' => now()]);
        // no scheduler on shared hosting: a PC's heartbeat sweeps stale mail and seats too
        RoomSignal::pruneStale();
        GlobalSeat::query()->stale()->delete();

        return [
            'state' => GameHost::ONLINE,
            'room' => $row->toPublic(),
            'seed' => $pc->seed,
            'rules' => GameRules::fromSettings()->toArray(),
            'commands' => $this->takePcCommands($pc),
        ];
    }

    /**
     * The admin's "mark offline", for a PC that is paused and will not be back soon:
     * the world closes and its waiting players are sent back to the lobby. A PC that is
     * in fact still running opens it again on its next heartbeat.
     */
    public function markOffline(GameHost $pc): void
    {
        $pc->update(['offline_at' => now(), 'paused_at' => null, 'players' => 0]);
        $this->closePcRoom($pc);
        $pc->seats()->delete();
    }

    /** the PC's room row, while it is online and refreshing it */
    public function pcRoom(GameHost $pc): ?Room
    {
        if ($pc->state() !== GameHost::ONLINE || $pc->room_code === null) {
            return null;
        }

        return Room::query()->live()->where('code', $pc->room_code)->first();
    }

    /** the host key whose PC runs this room, if it is a global world's */
    public function pcOfRoom(Room $room): ?GameHost
    {
        if (! $room->isGlobal()) {
            return null;
        }

        return GameHost::query()->where('room_code', $room->code)->where('enabled', true)->first();
    }

    private function openPcRoom(GameHost $pc, int $players): Room
    {
        return Room::query()->updateOrCreate(
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
    }

    private function closePcRoom(GameHost $pc): void
    {
        if ($pc->room_code === null) {
            return;
        }
        $room = Room::query()->where('code', $pc->room_code)->whereNull('user_id')->first();
        if ($room) {
            RoomSignal::query()->where('room_code', $room->code)->delete();
            $room->delete();
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
}
