/**
 * HUD: logo, health/stamina bars, ammo, hotbar, crosshair with break progress,
 * click-to-play overlay. All React DOM over the canvas; state comes from the UI store.
 */
import { useUiStore } from '../state/uiStore'
import { BLOCK_NAMES } from '../world/palette'
import { getItem } from '../items/registry'
import type { ItemStack } from '../items/inventory'
import { ItemIcon } from './ItemIcon'
import { CraftingPanel } from './CraftingPanel'
import { MainMenu } from './MainMenu'
import { InvitePanel } from './InvitePanel'
import { formatTime } from '../game/score'
import { api } from '../net/api'
import { router } from '@inertiajs/react'
import { useState } from 'react'
import './hud.css'

function Slot({ stack, index, active }: { stack: ItemStack | null; index: number; active: boolean }) {
  const def = stack ? getItem(stack.id) : null
  return (
    <div className={`slot${active ? ' active' : ''}`} title={def?.name}>
      <span className="key">{index + 1}</span>
      {def && <ItemIcon def={def} />}
      {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
      {def && active && <span className="name">{def.name}</span>}
    </div>
  )
}

function Bar({ kind, value, max }: { kind: 'health' | 'stamina'; value: number; max: number }) {
  return (
    <div className={`bar ${kind}`}>
      <span className="bar-icon">{kind === 'health' ? '♥' : '»'}</span>
      <div className="track"><div className="fill" style={{ width: `${(100 * value) / max}%` }} /></div>
      <span className="value">{Math.round(value)}</span>
    </div>
  )
}

export function Hud() {
  const locked = useUiStore(s => s.locked)
  const slot = useUiStore(s => s.hotbarSlot)
  const hotbar = useUiStore(s => s.hotbar)
  const targetBlock = useUiStore(s => s.targetBlock)
  const [x, y, z] = useUiStore(s => s.position)
  const health = useUiStore(s => s.health)
  const stamina = useUiStore(s => s.stamina)
  const ammo = useUiStore(s => s.ammo)
  const cameraMode = useUiStore(s => s.cameraMode)
  const breakProgress = useUiStore(s => s.breakProgress)
  const canBreak = useUiStore(s => s.canBreak)
  const panel = useUiStore(s => s.panel)
  const message = useUiStore(s => s.message)
  const interactHint = useUiStore(s => s.interactHint)
  const timer = useUiStore(s => s.timer)
  const phase = useUiStore(s => s.phase)
  const night = useUiStore(s => s.night)
  const zombies = useUiStore(s => s.zombies)
  const kills = useUiStore(s => s.kills)
  const hurtAt = useUiStore(s => s.hurtAt)
  const poisoned = useUiStore(s => s.poisoned)
  const aiming = useUiStore(s => s.aiming)
  const reloading = useUiStore(s => s.reloading)
  const dead = useUiStore(s => s.dead)
  const respawnIn = useUiStore(s => s.respawnIn)
  const score = useUiStore(s => s.score)
  const bestScore = useUiStore(s => s.bestScore)
  const nightsSurvived = useUiStore(s => s.nightsSurvived)
  const timeAlive = useUiStore(s => s.timeAlive)
  const scoreboard = useUiStore(s => s.scoreboard)
  const restart = useUiStore(s => s.restart)
  const game = useUiStore(s => s.game)
  const launch = useUiStore(s => s.launch)
  const players = useUiStore(s => s.players)
  const roomCode = useUiStore(s => s.roomCode)
  const role = useUiStore(s => s.role)
  const netStatus = useUiStore(s => s.netStatus)
  const netError = useUiStore(s => s.netError)
  const [saving, setSaving] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [inviting, setInviting] = useState(false)

  if (!launch) return <MainMenu />

  /** back to the lobby: the host's world is uploaded first when anything changed */
  const leave = async () => {
    if (game?.needsSave) {
      setLeaving(true)
      try {
        await game.saveToCloud()
      } catch {
        // the autosave / beacon paths keep trying; leaving must still work offline
      }
      setLeaving(false)
    }
    restart()
  }

  const saveToCloud = async () => {
    if (!game) return
    setSaving('Saving…')
    try {
      await game.saveToCloud()
      setSaving('Saved')
      router.reload({ only: ['worlds'] }) // the menu's world summaries
    } catch (e) {
      setSaving(e instanceof Error ? e.message : 'Save failed')
    }
    setTimeout(() => setSaving(''), 2500)
  }

  return (
    <div className={`hud${poisoned ? ' poisoned' : ''}`}>
      {/* key forces the vignette animation to restart on every hit */}
      {hurtAt > 0 && <div key={hurtAt} className="hurt" aria-hidden />}
      {aiming && <div className="scope" aria-hidden />}

      <div className="logo">BLOCK<span>SURVIVAL</span></div>
      {roomCode && (
        <div className="room">
          <span className="room-label">{role === 'host' ? 'room code' : 'joined'}</span>
          <span className="room-code">{roomCode}</span>
          <span className="room-players">{players.length} / 4</span>
        </div>
      )}
      <div className={`timer ${phase}`}>
        <span className="clock">{timer}</span>
        <span className="label">{phase === 'night' ? `night ${night} · ${zombies} out there` : night ? `day ${night + 1}` : 'sunset in'}</span>
      </div>
      <div className="debug">
        {x.toFixed(1)}, {y.toFixed(1)}, {z.toFixed(1)}
        {targetBlock ? ` · ${BLOCK_NAMES[targetBlock].replace('_', ' ')}${canBreak ? '' : ' (needs pickaxe)'}` : ''}
        {` · ${cameraMode === 'first' ? '1st' : '3rd'} person (V) · kills ${kills}`}
      </div>

      <div className="vitals">
        <Bar kind="health" value={health} max={100} />
        <Bar kind="stamina" value={stamina} max={100} />
      </div>

      {ammo && (
        <div className={`ammo${reloading ? ' reloading' : ''}`}>
          <span className="mag">{reloading ? '··' : ammo.mag}</span>
          <span className="sep">/</span>
          <span className="reserve">{ammo.reserve}</span>
          <span className="mag-icon">▮</span>
        </div>
      )}

      {message && <div className="toast">{message}</div>}
      {locked && interactHint && <div className="interact-hint">{interactHint}</div>}

      {locked && !aiming && (
        <div className="crosshair" aria-hidden>
          {breakProgress > 0 && (
            <div className="break-ring" style={{ background: `conic-gradient(#fff ${breakProgress * 360}deg, transparent 0)` }} />
          )}
        </div>
      )}

      <div className="hotbar">
        {hotbar.map((stack, i) => <Slot key={i} stack={stack} index={i} active={i === slot} />)}
      </div>

      {panel === 'crafting' && <CraftingPanel />}

      {dead && (
        <div className="death">
          <h1>You died</h1>
          <p className="respawn">Respawning in <b>{respawnIn}</b></p>
          <p className="sub">Your gear is in a crate where you fell · score {score}</p>
        </div>
      )}

      {(scoreboard || (!locked && panel === 'none')) && (
        <table className="scoreboard">
          <thead>
            <tr><th>Player</th><th>Score</th><th>Nights</th><th>Kills</th><th>Deaths</th><th>Time</th></tr>
          </thead>
          <tbody>
            {players.map(p => (
              <tr key={p.id} className={p.you ? 'you' : ''}>
                <td>{p.name}{p.you ? ' (you)' : ''}</td><td>{p.score}</td><td>{nightsSurvived}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{formatTime(timeAlive)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6}>best {bestScore} · nights × 100 + kills × 5</td></tr>
          </tfoot>
        </table>
      )}

      {netStatus && (
        <div className="overlay netdown">
          <h1>{netStatus === 'host-left' ? 'The host left' : 'Connection lost'}</h1>
          <p>{netStatus === 'host-left' ? 'The match is over: the host was running the world.' : netError || 'The connection to the host dropped.'}</p>
          <button className="restart" onClick={() => restart()}>Back to menu</button>
        </div>
      )}

      {!locked && panel === 'none' && !dead && !netStatus && (
        <div className="overlay" onClick={() => game?.input.requestLock()}>
          <h1>Block Survival</h1>
          <p>Click to {timeAlive > 2 ? 'resume' : 'play'}</p>
          <ul>
            <li><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>V</b> camera · <b>Tab</b> scores</li>
            <li><b>Hold left</b> dig / swing · <b>Right</b> place / aim · <b>1–9</b> select · <b>Q</b> drop</li>
            <li><b>E</b> inventory &amp; crafting · <b>F</b> workbench / bed / loot · <b>R</b> reload</li>
          </ul>
          {timeAlive > 2 && (
            <div className="pause-actions" onClick={e => e.stopPropagation()}>
              {role === 'host' && api.loggedIn && (
                <button className="restart secondary" onClick={saveToCloud} disabled={saving === 'Saving…'}>
                  {saving || 'Save world'}
                </button>
              )}
              {role === 'host' && roomCode && (
                <button className="restart secondary" onClick={() => setInviting(v => !v)}>
                  {inviting ? 'Hide invitations' : 'Invite players'}
                </button>
              )}
              <button className="restart" onClick={() => void leave()} disabled={leaving}>
                {leaving ? 'Saving…' : role === 'client' ? 'Leave game' : 'Back to menu'}
              </button>
            </div>
          )}
          {role === 'host' && roomCode && inviting && (
            <InvitePanel code={roomCode} joinedNames={players.filter(p => !p.you).map(p => p.name)} onClose={() => setInviting(false)} />
          )}
          {role === 'host' && !roomCode && (
            <p className="fine">Want friends in? Start from the menu with <b>Host for friends</b>, then invite them from here.</p>
          )}
          {role === 'client' && timeAlive > 2 && (
            <p className="fine">Your gear and respawn point are saved with the host's world — rejoin it to get them back.</p>
          )}
        </div>
      )}
    </div>
  )
}
