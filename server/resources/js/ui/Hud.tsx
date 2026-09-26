/**
 * HUD: logo, health/stamina bars, ammo, hotbar, crosshair with break progress,
 * click-to-play overlay. All React DOM over the canvas; state comes from the UI store.
 */
import { followClientStatus, useUiStore } from '../state/uiStore'
import { BLOCK_DEFS, BLOCK_NAMES, type BlockId } from '../world/palette'
import { depthBand, depthNote, oreOf } from '../world/ores'
import { getItem } from '../items/registry'
import type { ItemStack } from '../items/inventory'
import { ItemIcon, cssColour } from './ItemIcon'
import { CraftingPanel } from './CraftingPanel'
import { MainMenu } from './MainMenu'
import { InvitePanel } from './InvitePanel'
import { PlayerMarkers } from './PlayerMarkers'
import { OreMarkers } from './OreMarkers'
import { formatTime } from '../game/score'
import { verticalHint } from '../game/locator'
import type { ScoreRow } from '../state/uiStore'
import { savedPlayerOf } from '../game/saveState'
import { api } from '../net/api'
import { awaitHostPc, handover, liveDeps, PAUSED_TEXT, reconnectGlobal, rejoinRoom } from '../net/globalWorld'
import type { ClientSession } from '../net/ClientSession'
import { router } from '@inertiajs/react'
import { useEffect, useState } from 'react'
import './hud.css'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

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

/** the scoreboard's answer to "where are they?": distance, an arrow relative to where you look, up/down */
function Where({ row }: { row: ScoreRow }) {
  if (!row.where) return <td className="where">—</td>
  const hint = verticalHint(row.where.dy)
  return (
    <td className="where">
      <span className="arrow" style={{ transform: `rotate(${row.where.bearing}deg)` }}>▲</span>
      {row.where.distance} m{hint && <span className="vert"> · {hint}</span>}
    </td>
  )
}

/** the prospector in hand (issue #25): what it is tuned to, how far it reaches, what it has found */
function Prospector() {
  const p = useUiStore(s => s.prospector)
  if (!p) return null
  const ore = oreOf(p.ore)
  const colour = cssColour(BLOCK_DEFS[p.ore as BlockId].colours[0], 1.5)
  return (
    <div className="prospector">
      <span className="label">prospector · {p.range} m</span>
      <span className="tuned" style={{ color: colour }}>{ore?.drop ?? 'ore'}</span>
      <span className="found">{p.found ? `${p.found} nearby` : 'nothing in range'}</span>
      <span className="tune-hint">right-click to tune</span>
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
  const surfaceY = useUiStore(s => s.surfaceY)
  const restart = useUiStore(s => s.restart)
  const game = useUiStore(s => s.game)
  const launch = useUiStore(s => s.launch)
  const players = useUiStore(s => s.players)
  const roomCode = useUiStore(s => s.roomCode)
  const role = useUiStore(s => s.role)
  const netStatus = useUiStore(s => s.netStatus)
  const netError = useUiStore(s => s.netError)
  const setNetStatus = useUiStore(s => s.setNetStatus)
  const [saving, setSaving] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  /** progress while a handover or reconnect is under way */
  const [netText, setNetText] = useState('')
  const isGlobal = launch?.worldKind === 'global'

  /** wired onto every session a handover or reconnect opens, so the HUD hears when that match ends too */
  const onClientStatus = (session: ClientSession, st: ClientSession['status']) => followClientStatus(session, st)
  const onHostLost = (reason: string) => setNetStatus('error', reason)

  // the global world's host left: keep our seat and follow the queue — either we host
  // now (with our own gear carried over) or we connect to whoever does. The old game
  // stays on screen behind the overlay until the new launch replaces it.
  useEffect(() => {
    if (netStatus !== 'host-left' || !launch || launch.role !== 'client' || launch.worldKind !== 'global' || !game) return
    setNetStatus('handover')
    setNetText('Choosing the next host…')
    const mine = api.user ? savedPlayerOf(game.local) : null
    const deps = liveDeps({ onStatus: setNetText, onClientStatus, onHostLost })
    handover(launch.name, mine, launch.session.code, deps).then(
      next => {
        // the player may have gone back to the menu while we waited
        if (useUiStore.getState().netStatus === 'handover') useUiStore.getState().start(next)
        else next.session.dispose()
      },
      e => { if (useUiStore.getState().netStatus === 'handover') setNetStatus('error', errorText(e)) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per host-left
  }, [netStatus])

  // the host PC went quiet (docs/pc-host-research.md §5.4): the game is frozen; wait for
  // the PC — however long — and go back in, or follow the queue if it was released. A
  // pause the PC lifts over the same link just clears the overlay (followClientStatus).
  useEffect(() => {
    if (netStatus !== 'paused' || !launch || launch.role !== 'client' || !game) return
    setNetText(PAUSED_TEXT)
    const old = launch.session
    const mine = api.user ? savedPlayerOf(game.local) : null
    const stillPaused = () => useUiStore.getState().netStatus === 'paused' && useUiStore.getState().launch?.session === old
    const deps = liveDeps({ onStatus: setNetText, onClientStatus, onHostLost })
    awaitHostPc(launch.name, mine, deps, stillPaused).then(
      next => {
        if (!next) return
        if (!stillPaused()) { next.session.dispose(); return }
        old.onStatus = null
        old.dispose()
        useUiStore.getState().start(next)
      },
      e => { if (stillPaused()) setNetStatus('error', errorText(e)) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per pause
  }, [netStatus])

  if (!launch) return <MainMenu />

  /** back to the lobby: the host's world is uploaded first when anything changed; a seat in the global world is given up */
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
    // a global host's room closes with its game, which is leaving; a client says so itself
    if (isGlobal && role === 'client') api.leaveGlobal().catch(() => {})
    restart()
  }

  /**
   * The link dropped: get back into the world we were in. Our old session is finished
   * first — a host's room is closed (its seat in the global world goes with it) before
   * we ask for a place again, so the server sees the world without us. The old game
   * stays on screen behind the overlay until the new launch replaces it.
   */
  const reconnect = async () => {
    if (!launch) return
    setNetStatus('reconnecting')
    setNetText('Reconnecting…')
    const mine = api.user && game ? savedPlayerOf(game.local) : null
    if (launch.role === 'host') {
      launch.session.onLost = null
      await launch.session.close()
    } else {
      launch.session.onStatus = null
      launch.session.dispose()
    }
    const deps = liveDeps({ onStatus: setNetText, onClientStatus, onHostLost })
    try {
      const next = isGlobal
        ? await reconnectGlobal(launch.name, mine, deps)
        : await rejoinRoom(launch.session.code, launch.name, launch.worldKind, deps)
      // the player may have gone back to the menu while we waited
      if (useUiStore.getState().netStatus === 'reconnecting') useUiStore.getState().start(next)
      else next.session.dispose()
    } catch (e) {
      if (useUiStore.getState().netStatus === 'reconnecting') setNetStatus('error', errorText(e))
    }
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
        {` · ${depthNote(y, surfaceY)} · ${depthBand(Math.round(y))}`}
        {targetBlock ? ` · ${BLOCK_NAMES[targetBlock].replace('_', ' ')}${canBreak ? '' : ' (needs a better pickaxe)'}` : ''}
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

      <PlayerMarkers />
      <OreMarkers />
      {locked && <Prospector />}

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
            <tr><th>Player</th><th>Score</th><th>Nights</th><th>Kills</th><th>Deaths</th><th>Time</th><th>Where</th></tr>
          </thead>
          <tbody>
            {players.map(p => (
              <tr key={p.id} className={p.you ? 'you' : ''}>
                <td>{p.name}{p.you ? ' (you)' : ''}</td><td>{p.score}</td><td>{nightsSurvived}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{formatTime(timeAlive)}</td>
                <Where row={p} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={7}>best {bestScore} · nights × 100 + kills × 5 · arrows point from where you look</td></tr>
          </tfoot>
        </table>
      )}

      {netStatus && (
        <div className={`overlay netdown${netStatus === 'reconnecting' || netStatus === 'paused' ? ' busy' : ''}`}>
          <h1>
            {netStatus === 'paused' ? 'Game paused' : netStatus === 'host-left' || netStatus === 'handover' ? 'The host left' : netStatus === 'reconnecting' ? 'Reconnecting' : 'Connection lost'}
          </h1>
          <p>
            {netStatus === 'paused'
              ? netText || PAUSED_TEXT
              : netStatus === 'handover'
              ? `The world moves to the next player in. ${netText}`
              : netStatus === 'reconnecting'
                ? netText
                : netStatus === 'host-left'
                  ? 'The match is over: the host was running the world.'
                  : netError || 'The connection to the host dropped.'}
          </p>
          <div className="pause-actions">
            {netStatus === 'error' && (
              <button className="restart" onClick={() => void reconnect()}>Reconnect</button>
            )}
            <button className={`restart${netStatus === 'error' ? ' secondary' : ''}`} onClick={() => void leave()} disabled={leaving}>
              {leaving ? 'Saving…' : 'Back to menu'}
            </button>
          </div>
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
              {role === 'host' && roomCode && !isGlobal && (
                <button className="restart secondary" onClick={() => setInviting(v => !v)}>
                  {inviting ? 'Hide invitations' : 'Invite players'}
                </button>
              )}
              <button className="restart" onClick={() => void leave()} disabled={leaving}>
                {leaving ? 'Saving…' : role === 'client' ? 'Leave game' : 'Back to menu'}
              </button>
            </div>
          )}
          {role === 'host' && roomCode && !isGlobal && inviting && (
            <InvitePanel code={roomCode} joinedNames={players.filter(p => !p.you).map(p => p.name)} onClose={() => setInviting(false)} />
          )}
          {role === 'host' && !roomCode && (
            <p className="fine">Want friends in? Start from the menu with <b>Host for friends</b>, then invite them from here.</p>
          )}
          {isGlobal && (
            <p className="fine">
              {role === 'host' ? 'You are hosting the global world; anyone can enter it from the lobby, and the next player in takes over when you leave.' : 'Your gear and respawn point are saved with the world — it hands over to the next player in when the host leaves.'}
            </p>
          )}
          {!isGlobal && role === 'client' && timeAlive > 2 && (
            <p className="fine">Your gear and respawn point are saved with the host's world — rejoin it to get them back.</p>
          )}
        </div>
      )}
    </div>
  )
}
