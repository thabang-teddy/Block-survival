using BlockSurvival.Physics;
using UnityEngine;

namespace BlockSurvival.App
{
    /// Maps the browser `KeyboardEvent.code` strings <see cref="PlayerController"/>
    /// reads (see <c>physics/playerController.ts</c> / <c>input/Input.ts</c>) onto
    /// Unity's <see cref="Input"/> class.
    public sealed class UnityPlayerInput : IPlayerInput
    {
        public bool IsDown(string code) => code switch
        {
            "KeyW" => Input.GetKey(KeyCode.W),
            "KeyA" => Input.GetKey(KeyCode.A),
            "KeyS" => Input.GetKey(KeyCode.S),
            "KeyD" => Input.GetKey(KeyCode.D),
            "ShiftLeft" => Input.GetKey(KeyCode.LeftShift),
            "Space" => Input.GetKey(KeyCode.Space),
            _ => false,
        };
    }
}
