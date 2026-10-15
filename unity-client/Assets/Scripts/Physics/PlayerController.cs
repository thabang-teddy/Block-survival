using System.Collections.Generic;
using BlockSurvival.World;

namespace BlockSurvival.Physics
{
    /// First-person player — twin of <c>physics/playerController.ts</c>: mouse
    /// look, WASD, sprint, jump, gravity, step-up, updraft lift, all resolved
    /// against the voxel world with swept AABBs.
    public static class PlayerTuning
    {
        public const double Width = 0.6;
        public const double Height = 1.8;
        public const double EyeHeight = 1.62;
        public const double WalkSpeed = 4.3;
        public const double SprintSpeed = 7.0;
        public const double JumpSpeed = 8.0;
        public const double Gravity = 25;
        public const double StepHeight = 0.55;
        public const double GroundAccel = 40;
        public const double AirAccel = 10;
        public const double MouseSensitivity = 0.0022;

        /// px of look applied in one tick at most: more than this is a stall, not a move
        public const double MaxLookPerTick = 400;

        /// below the bedrock at y = 0: something went wrong, put the player back on the pad
        public const double VoidY = -8;
        public const double MaxStamina = 100;
        public const double StaminaDrain = 15;
        public const double StaminaRegen = 12;
        public const double StaminaRegenDelay = 1.0;
    }

    public static class PlayerMath
    {
        /// normalise an angle into (-pi, pi]
        public static double WrapAngle(double a)
        {
            const double twoPi = System.Math.PI * 2;
            // C#'s `%` on doubles keeps the sign of the dividend, like JS `%`.
            a %= twoPi;
            if (a > System.Math.PI) a -= twoPi;
            else if (a <= -System.Math.PI) a += twoPi;
            return a;
        }
    }

    /// the keys the controller reads, by the browser's KeyboardEvent.code names
    public interface IPlayerInput
    {
        bool IsDown(string code);
    }

    public sealed class KeySetInput : IPlayerInput
    {
        public readonly HashSet<string> Down;

        public KeySetInput(IEnumerable<string> down = null) => Down = down != null ? new HashSet<string>(down) : new HashSet<string>();

        public bool IsDown(string code) => Down.Contains(code);
    }

    public sealed class PlayerState
    {
        /// feet centre
        public double X, Y, Z;
        public double Vx, Vy, Vz;
        public double Yaw, Pitch;
        public bool OnGround;
        public double Stamina = PlayerTuning.MaxStamina;

        /// true while actually sprinting this tick
        public bool Sprinting;

        /// seconds since the player last sprinted
        public double SinceSprint = 99;

        /// standing in an updraft shaft: Space rises, Shift sinks, otherwise hover
        public bool InUpdraft;

        public PlayerState(double x, double y, double z)
        {
            X = x; Y = y; Z = z;
        }
    }

    public delegate List<Updraft> UpdraftsNearFn(double x, double z);

    public sealed class PlayerController
    {
        private readonly WorldStore _world;
        public readonly PlayerState State;

        /// respawn point (the bed sets this)
        public double SpawnX, SpawnY, SpawnZ;
        private bool _jumpQueued;

        /// the updraft shafts near a point (the terrain generator's; tests pass a fake)
        public UpdraftsNearFn Updrafts = (_, _) => new List<Updraft>();

        public PlayerController(WorldStore world, double x, double y, double z)
        {
            _world = world;
            SpawnX = x;
            SpawnY = y;
            SpawnZ = z;
            State = new PlayerState(x, y, z);
        }

        public Box Box
        {
            get
            {
                var s = State;
                const double half = PlayerTuning.Width / 2;
                return new Box(s.X - half, s.Y, s.Z - half, PlayerTuning.Width, PlayerTuning.Height, PlayerTuning.Width);
            }
        }

        /// would placing a solid block at this voxel overlap the player?
        public bool OverlapsVoxel(int x, int y, int z)
        {
            var b = Box;
            return b.X < x + 1 && b.X + b.W > x &&
                   b.Y < y + 1 && b.Y + b.H > y &&
                   b.Z < z + 1 && b.Z + b.D > z;
        }

        public void Teleport(double x, double y, double z)
        {
            State.X = x; State.Y = y; State.Z = z;
            State.Vx = 0; State.Vy = 0; State.Vz = 0;
        }

        public void QueueJump() => _jumpQueued = true;

        private void UpdateVitals(double dt, bool wantSprint, bool moving)
        {
            var s = State;
            s.Sprinting = wantSprint && moving && s.Stamina > 0 && s.OnGround;
            if (s.Sprinting)
            {
                s.Stamina = System.Math.Max(0.0, s.Stamina - PlayerTuning.StaminaDrain * dt);
                s.SinceSprint = 0;
            }
            else
            {
                s.SinceSprint += dt;
                if (s.SinceSprint > PlayerTuning.StaminaRegenDelay)
                {
                    s.Stamina = System.Math.Min(PlayerTuning.MaxStamina, s.Stamina + PlayerTuning.StaminaRegen * dt);
                }
            }
        }

        /// Apply one tick of mouse delta (px), capped so a stall is not a spin.
        public void Look(double dx, double dy)
        {
            var s = State;
            const double cap = PlayerTuning.MaxLookPerTick;
            dx = System.Math.Max(-cap, System.Math.Min(cap, dx));
            dy = System.Math.Max(-cap, System.Math.Min(cap, dy));
            s.Yaw = PlayerMath.WrapAngle(s.Yaw - dx * PlayerTuning.MouseSensitivity);
            s.Pitch -= dy * PlayerTuning.MouseSensitivity;
            const double limit = System.Math.PI / 2 - 0.01;
            s.Pitch = System.Math.Max(-limit, System.Math.Min(limit, s.Pitch));
        }

        /// `frozen` (dead / in a menu): keys are ignored, only gravity applies
        public void Update(double dt, IPlayerInput input, bool frozen = false)
        {
            var s = State;
            bool Down(string code) => !frozen && input.IsDown(code);
            // ---- wish direction in world space (yaw 0 looks down -Z)
            var fwd = 0.0;
            var side = 0.0;
            if (Down("KeyW")) fwd += 1;
            if (Down("KeyS")) fwd -= 1;
            if (Down("KeyD")) side += 1;
            if (Down("KeyA")) side -= 1;
            var rawLen = JsMath.Hypot(fwd, side);
            var len = rawLen == 0 ? 1.0 : rawLen;
            fwd /= len;
            side /= len;
            var sinY = JsMath.JsSin(s.Yaw);
            var cosY = JsMath.JsCos(s.Yaw);
            var wishX = -sinY * fwd + cosY * side;
            var wishZ = -cosY * fwd - sinY * side;
            UpdateVitals(dt, Down("ShiftLeft"), fwd != 0 || side != 0);
            var speed = s.Sprinting ? PlayerTuning.SprintSpeed : PlayerTuning.WalkSpeed;
            var accel = (s.OnGround ? PlayerTuning.GroundAccel : PlayerTuning.AirAccel) * dt;
            s.Vx += System.Math.Max(-accel, System.Math.Min(accel, wishX * speed - s.Vx));
            s.Vz += System.Math.Max(-accel, System.Math.Min(accel, wishZ * speed - s.Vz));

            // ---- vertical
            var shaft = frozen ? null : UpdraftGen.UpdraftAt(Updrafts(s.X, s.Z), s.X, s.Y, s.Z);
            s.InUpdraft = shaft != null;
            if (shaft != null)
            {
                // the shaft carries you: ease towards rise / sink / hover, never past its top
                var want = Down("Space") ? UpdraftTuning.Rise : (Down("ShiftLeft") ? -UpdraftTuning.Sink : 0.0);
                var step = UpdraftTuning.Accel * dt;
                s.Vy += System.Math.Max(-step, System.Math.Min(step, want - s.Vy));
                if (s.Vy > 0 && s.Y + s.Vy * dt > shaft.TopY)
                {
                    s.Vy = System.Math.Max(0.0, (shaft.TopY - s.Y) / dt);
                }
            }
            else
            {
                if (_jumpQueued && s.OnGround && !frozen) s.Vy = PlayerTuning.JumpSpeed;
                s.Vy -= PlayerTuning.Gravity * dt;
                s.Vy = System.Math.Max(s.Vy, -50.0);
            }
            _jumpQueued = false;

            Move(s.Vx * dt, s.Vy * dt, s.Vz * dt);
            if (s.Y < PlayerTuning.VoidY) Teleport(SpawnX, SpawnY, SpawnZ);
        }

        private void Move(double dx, double dy, double dz)
        {
            var s = State;
            var start = Box;
            var r = Aabb.MoveBox(_world, start, dx, dy, dz);
            // step-up: blocked horizontally while grounded -> try again from one step higher
            if ((r.HitX || r.HitZ) && s.OnGround)
            {
                var raised = Aabb.MoveBox(_world, start, 0, PlayerTuning.StepHeight, 0);
                if (!raised.HitY)
                {
                    var stepped = Aabb.MoveBox(_world, raised.Box, dx, 0, dz);
                    var settled = Aabb.MoveBox(_world, stepped.Box, 0, -PlayerTuning.StepHeight, 0);
                    var gained = JsMath.Hypot(stepped.Box.X - raised.Box.X, stepped.Box.Z - raised.Box.Z);
                    var original = JsMath.Hypot(r.Box.X - start.X, r.Box.Z - start.Z);
                    if (gained > original + 1e-3 && settled.HitY && !Aabb.BoxIntersectsSolid(_world, settled.Box))
                    {
                        r = new MoveResult(settled.Box, stepped.HitX, true, stepped.HitZ);
                    }
                }
            }
            const double half = PlayerTuning.Width / 2;
            s.X = r.Box.X + half;
            s.Y = r.Box.Y;
            s.Z = r.Box.Z + half;
            if (r.HitX) s.Vx = 0;
            if (r.HitZ) s.Vz = 0;
            if (r.HitY)
            {
                s.OnGround = dy <= 0;
                s.Vy = 0;
            }
            else
            {
                s.OnGround = false;
            }
        }
    }
}
