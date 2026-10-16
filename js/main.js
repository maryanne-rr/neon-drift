/**
 * main.js
 * -------
 * The race: the grid, the countdown, three laps, the timing, and everything
 * that comes back from start.ng.
 *
 * The driving itself is not in this file. `track.js` owns that maths (and the
 * tests), this file draws it and keeps score.
 */

import * as THREE from 'three';
import { clamp, createTrack, defaultControlPoints, driveCar, formatTime, lapAfterStep, racePositions } from './track.js';
import { buildWorld } from './world.js';
import { createKart, createRivalKart } from './kart.js';
import * as SN from './startng.js';

const LAPS = 3;
const BEST_KEY = 'neon-drift.best-lap';
const track = createTrack(defaultControlPoints());

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const container = document.getElementById('game');

let renderer;
try {
  // preserveDrawingBuffer lets the canvas be saved as an image (used by the
  // screenshot helper in the debug object at the bottom of this file).
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
} catch {
  document.getElementById('loading').innerHTML =
    '<p>This game needs WebGL, which your browser or device did not turn on.</p>';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1600);
buildWorld(scene, track);

scene.add(new THREE.HemisphereLight('#dbe9ff', '#3a3a26', 1.2));
const sun = new THREE.DirectionalLight('#fff0d0', 2.4);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 320;
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------
const player = {
  id: 'player',
  isPlayer: true,
  lap: 0,
  d: 20,
  offset: 4,
  speed: 0,
  lateral: 0,
  lane: 4,
};
const rivals = [
  { id: 'ai-1', isPlayer: false, lap: 0, d: 2, offset: -4, speed: 0, lateral: 0, lane: -4, skill: 0.99, phase: 0 },
  { id: 'ai-2', isPlayer: false, lap: 0, d: 8, offset: 4, speed: 0, lateral: 0, lane: 4, skill: 1.01, phase: 2 },
  { id: 'ai-3', isPlayer: false, lap: 0, d: 14, offset: -4, speed: 0, lateral: 0, lane: -4, skill: 1.03, phase: 4 },
];
const field = [player, ...rivals];

const kartViews = new Map();

function addRival(racer, index) {
  const kart = createRivalKart(index);
  scene.add(kart.group);
  kartViews.set(racer.id, kart);
}

// ---------------------------------------------------------------------------
// Race state
// ---------------------------------------------------------------------------
let phase = 'loading'; // loading | countdown | racing | finished
let raceTime = 0;
let lapStart = 0;
let bestLap = Infinity;
let countdownToken = 0;
let state = { signedIn: false, playerId: null, player: null };
let autopilot = false; // lets the test harness drive the player car

const ui = {
  loading: document.getElementById('loading'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  card: document.getElementById('card'),
  face: document.getElementById('face'),
  name: document.getElementById('name'),
  account: document.getElementById('account'),
  signIn: document.getElementById('sign-in'),
  lap: document.getElementById('lap'),
  place: document.getElementById('place'),
  lapTime: document.getElementById('lap-time'),
  bestTime: document.getElementById('best-time'),
  personalBest: document.getElementById('personal-best'),
  speed: document.getElementById('speed'),
  offTrack: document.getElementById('off-track'),
  end: document.getElementById('end'),
  endPlace: document.getElementById('end-place'),
  endTotal: document.getElementById('end-total'),
  endBest: document.getElementById('end-best'),
  endRank: document.getElementById('end-rank'),
  raceAgain: document.getElementById('race-again'),
  board: document.getElementById('board'),
  boardList: document.getElementById('board-list'),
  boardToggle: document.getElementById('board-toggle'),
  boardClose: document.getElementById('board-close'),
  touchSteer: document.getElementById('touch-steer'),
  touchThrottle: document.getElementById('touch-throttle'),
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
const touch = { steer: 0, throttle: 0 };

addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if ((event.code === 'Enter' || event.code === 'KeyR') && phase === 'finished') startRace();
});
addEventListener('keyup', (event) => keys.delete(event.code));
addEventListener('blur', () => keys.clear());

/** Turns the keyboard and the touch controls into one set of pedals. */
function readInput() {
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || touch.steer < 0;
  const right = keys.has('KeyD') || keys.has('ArrowRight') || touch.steer > 0;
  const throttle = keys.has('KeyW') || keys.has('ArrowUp') || touch.throttle > 0 ? 1 : 0;
  const brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  return { throttle, brake, steer: (right ? 1 : 0) - (left ? 1 : 0) };
}

/** Wires the on-screen buttons (shown only on touch screens). */
function wireTouchButton(element, onDown, onUp) {
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    element.classList.add('down');
    onDown();
  });
  const release = () => {
    element.classList.remove('down');
    onUp();
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('pointerleave', release);
}

wireTouchButton(ui.touchSteer.querySelector('[data-steer="-1"]'), () => (touch.steer = -1), () => (touch.steer = 0));
wireTouchButton(ui.touchSteer.querySelector('[data-steer="1"]'), () => (touch.steer = 1), () => (touch.steer = 0));
wireTouchButton(ui.touchThrottle, () => (touch.throttle = 1), () => (touch.throttle = 0));

// ---------------------------------------------------------------------------
// Race flow
// ---------------------------------------------------------------------------
function startRace() {
  // The grid sits just past the start line, so the first time a car reaches
  // the line again is the end of lap 1.
  const grid = [
    { racer: player, d: 20, offset: 4 },
    { racer: rivals[0], d: 2, offset: -4 },
    { racer: rivals[1], d: 8, offset: 4 },
    { racer: rivals[2], d: 14, offset: -4 },
  ];
  for (const { racer, d, offset } of grid) {
    racer.d = d;
    racer.offset = offset;
    racer.lane = offset;
    racer.lateral = 0;
    racer.speed = 0;
    racer.lap = 0; // otherwise "race again" starts on the old race's laps
  }

  raceTime = 0;
  lapStart = 0;
  bestLap = Infinity;
  phase = 'countdown';
  ui.end.hidden = true;
  countIn(3);
}

function countIn(from) {
  const token = (countdownToken += 1);
  ui.overlay.hidden = false;
  if (from === 0) {
    ui.overlayTitle.textContent = 'GO!';
    phase = 'racing';
    lapStart = 0;
    setTimeout(() => {
      if (token === countdownToken) ui.overlay.hidden = true;
    }, 600);
    return;
  }
  ui.overlayTitle.textContent = String(from);
  setTimeout(() => {
    if (token === countdownToken) countIn(from - 1);
  }, 750);
}

// ---------------------------------------------------------------------------
// Driving the field
// ---------------------------------------------------------------------------
function drivePlayer(dt) {
  return driveCar(player, dt, readInput(), track);
}

/** A rival picks a racing line, brakes for corners and aims for its own lane. */
function driveRival(rival, dt, elapsed) {
  const wander = Math.sin(elapsed * 0.6 + rival.phase) * 1.8;
  const target = rival.lane + wander;
  const steer = clamp((target - rival.offset) * 0.09 - rival.lateral * 0.3, -1, 1);
  const limit = track.speedLimitAhead(rival.d, 60) * rival.skill;
  const tooFast = rival.speed > limit + 1.5;
  return driveCar(
    rival,
    dt,
    { throttle: tooFast ? 0 : 1, brake: tooFast ? clamp((rival.speed - limit) / 6, 0, 1) : 0, steer },
    track
  );
}

/** Bumps between two cars: both lose a little speed and get nudged apart. */
function resolveBump(a, b) {
  const along = Math.min(Math.abs(a.d - b.d), track.length - Math.abs(a.d - b.d));
  if (along > 3.6) return false;
  if (Math.abs(a.offset - b.offset) > 1.9) return false;

  const push = Math.sign(a.offset - b.offset) || 1;
  a.offset += push * 0.5;
  b.offset -= push * 0.5;
  a.speed *= 0.94;
  b.speed *= 0.94;
  a.lateral -= push * 2;
  b.lateral += push * 2;
  return true;
}

/**
 * Moves one car on by a step, counting the lap if it crossed the line.
 * @param {object} racer the car being updated
 * @param {object} next  the car state driveCar returned
 * @param {Function} onLap called only when the car completed a lap
 */
function applyStep(racer, next, onLap) {
  const laps = lapAfterStep(racer, racer.d, next.d);
  const completedLap = laps > racer.lap;
  racer.d = next.d;
  racer.offset = next.offset;
  racer.speed = next.speed;
  racer.lateral = next.lateral;
  racer.lap = laps;
  if (completedLap) onLap?.();
}

function updateField(dt, elapsed) {
  const racing = phase === 'racing';

  // --- player ---
  if (racing) {
    const result = autopilot ? driveRival(player, dt, elapsed) : drivePlayer(dt);
    applyStep(player, result.car, onPlayerLap);
  }

  // --- rivals ---
  if (racing) {
    for (const rival of rivals) applyStep(rival, driveRival(rival, dt, elapsed).car);
  }

  // --- contact between any two cars ---
  for (let i = 0; i < field.length; i += 1) {
    for (let j = i + 1; j < field.length; j += 1) resolveBump(field[i], field[j]);
  }

  ui.offTrack.hidden = phase !== 'racing' || Math.abs(player.offset) <= track.halfWidth;
}

function onPlayerLap() {
  const lapTime = raceTime - lapStart;
  lapStart = raceTime;
  if (lapTime > 3) {
    bestLap = Math.min(bestLap, lapTime);
    const stored = Number(localStorage.getItem(BEST_KEY));
    if (!(stored > 0) || lapTime < stored) localStorage.setItem(BEST_KEY, String(lapTime));
  }
  // The lap counter now counts for the player and the computer karts alike,
  // which is what makes the finishing position mean anything.
  if (player.lap >= LAPS) finishRace();
}

async function finishRace() {
  phase = 'finished';

  ui.end.hidden = false;
  ui.endPlace.textContent = ordinal(placeOf(player));
  ui.endTotal.textContent = formatTime(raceTime);
  ui.endBest.textContent = Number.isFinite(bestLap) ? formatTime(bestLap) : 'no laps';
  ui.endRank.textContent = '';

  // The leaderboard wants whole seconds, so the saved time is rounded.
  if (state.signedIn && Number.isFinite(bestLap)) {
    const saved = await SN.saveRun({ bestlap: Math.round(bestLap) });
    if (saved?.ok) {
      ui.endRank.textContent = saved.result?.improved
        ? `New personal best! You are #${saved.result.rank} on the board.`
        : `Saved. You are #${saved.result?.rank ?? '-'} on the board.`;
    } else {
      ui.endRank.textContent = 'Could not save that lap. Try again in a moment.';
    }
  } else if (!state.signedIn) {
    ui.endRank.textContent = 'Sign in with start.ng to save your best lap.';
  }

  await refreshBoard();
}

/** 1st, 2nd, 3rd, 4th. */
function ordinal(place) {
  return place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
}

function placeOf(racer) {
  const rows = racePositions(field, track);
  return rows.find((row) => row.racer === racer)?.place ?? 1;
}

// ---------------------------------------------------------------------------
// Drawing the field
// ---------------------------------------------------------------------------
const up = new THREE.Vector3(0, 1, 0);

function placeView(racer) {
  const view = kartViews.get(racer.id);
  if (!view) return;

  const here = track.positionAt(racer.d, racer.offset);
  const ahead = track.positionAt(racer.d + 2.5, racer.offset);
  view.group.position.set(here.x, 0, here.z);
  view.group.rotation.y = Math.atan2(ahead.x - here.x, ahead.z - here.z);
  // Lean into the corner a little, like a kart on the edge of its grip.
  view.group.rotation.z = clamp(-racer.lateral * 0.05, -0.25, 0.25);
  view.spin(racer.speed, lastDelta);
  view.setSteer(clamp(-racer.lateral * 0.12, -1, 1));
  view.character?.update(lastDelta, racer.speed);
}

// ---------------------------------------------------------------------------
// start.ng
// ---------------------------------------------------------------------------
async function loadPlayer() {
  const result = await SN.whoami();
  state = { signedIn: result.signedIn, playerId: result.player.id ?? null, player: result.player };

  // The kart is rebuilt around the new driver's start.ng character.
  const old = kartViews.get(player.id);
  if (old) scene.remove(old.group);
  const kart = createKart({ color: '#d8fd71', accent: '#2b2f4a', style: result.player.style, name: result.player.name });
  scene.add(kart.group);
  kartViews.set(player.id, kart);

  if (result.face) ui.face.src = result.face;
  ui.name.textContent = result.player.name;
  ui.account.textContent = result.player.account ? `@${result.player.account}` : 'Playing as guest';
  ui.signIn.hidden = result.signedIn;
}

async function refreshBoard() {
  const entries = await SN.getLeaderboard(10);
  if (!entries.length) {
    ui.boardList.innerHTML = '<li class="empty">No laps saved yet. Be the first!</li>';
    return;
  }
  ui.boardList.replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement('li');
      if (entry.player_id === state.playerId) li.className = 'you';
      const rank = document.createElement('b');
      rank.textContent = `#${entry.rank}`;
      const name = document.createElement('span');
      name.textContent = entry.name;
      const time = document.createElement('em');
      time.textContent = entry.stats?.bestlap !== undefined ? `${entry.stats.bestlap}s` : `${entry.score}s`;
      li.append(rank, name, time);
      return li;
    })
  );
}

ui.signIn.addEventListener('click', SN.goToSignIn);
ui.raceAgain.addEventListener('click', startRace);
ui.boardToggle.addEventListener('click', () => {
  ui.board.hidden = !ui.board.hidden;
  if (!ui.board.hidden) refreshBoard();
});
ui.boardClose.addEventListener('click', () => {
  ui.board.hidden = true;
});

// ---------------------------------------------------------------------------
// Camera and HUD
// ---------------------------------------------------------------------------
const cameraTarget = new THREE.Vector3();
const cameraWanted = new THREE.Vector3();
const lookWanted = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, 1);

function updateCamera(dt) {
  const view = kartViews.get(player.id);
  const heading = view?.group.rotation.y ?? 0;
  forward.set(Math.sin(heading), 0, Math.cos(heading));

  cameraWanted
    .copy(view?.group.position ?? new THREE.Vector3())
    .addScaledVector(forward, -9.5)
    .addScaledVector(up, 3.9);
  camera.position.lerp(cameraWanted, 1 - Math.pow(0.0005, dt));

  lookWanted.copy(view?.group.position ?? new THREE.Vector3()).addScaledVector(forward, 9).addScaledVector(up, 1.4);
  cameraTarget.lerp(lookWanted, 1 - Math.pow(0.0004, dt));
  camera.lookAt(cameraTarget);

  // Widening the lens with speed is what makes it feel fast.
  const rush = clamp(player.speed / track.maxSpeed, 0, 1);
  camera.fov += (62 + rush * 20 - camera.fov) * (1 - Math.pow(0.02, dt));
  camera.updateProjectionMatrix();

  // Keep the shadow map around the player so it stays crisp.
  sun.position.set(view.group.position.x + 60, 90, view.group.position.z + 40);
  sun.target.position.copy(view.group.position);
  sun.target.updateMatrixWorld();
}

function updateHud() {
  ui.lap.textContent = `${Math.min(player.lap + 1, LAPS)}/${LAPS}`;
  ui.place.textContent = ordinal(placeOf(player));
  ui.lapTime.textContent = formatTime(raceTime - lapStart);
  ui.bestTime.textContent = Number.isFinite(bestLap) ? formatTime(bestLap) : '--:--.-';
  ui.speed.textContent = String(Math.round(player.speed * 3.6));
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let lastDelta = 0;
let elapsed = 0;

function tick() {
  requestAnimationFrame(tick);
  lastDelta = Math.min(clock.getDelta(), 0.05);
  elapsed += lastDelta;

  if (phase === 'racing') raceTime += lastDelta;
  updateField(lastDelta, elapsed);

  for (const racer of field) placeView(racer);
  updateCamera(lastDelta);
  updateHud();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
(async function start() {
  rivals.forEach(addRival);
  await loadPlayer();
  ui.personalBest.textContent = localStorage.getItem(BEST_KEY)
    ? `Your best: ${formatTime(Number(localStorage.getItem(BEST_KEY)))}`
    : '';

  ui.loading.hidden = true;
  tick();
  startRace();

  // The player may sign in or out on start.ng while the game is open.
  SN.onPlayerChange(() => loadPlayer());

  window.neonDrift = {
    scene,
    renderer,
    camera,
    track,
    player,
    rivals,
    startRace,
    // Skips the countdown, for tests and screenshots.
    begin() {
      phase = 'racing';
      lapStart = 0;
      ui.overlay.hidden = true;
    },
    // Hands the player's car to the computer, for end-to-end tests.
    autopilot(on = true) {
      autopilot = on;
      player.skill ??= 1.0;
      player.phase ??= 1;
    },
    snapshot: () => ({
      phase,
      lap: player.lap,
      speed: Number(player.speed.toFixed(1)),
      bestLap: Number.isFinite(bestLap) ? Number(bestLap.toFixed(2)) : null,
      signedIn: state.signedIn,
      place: placeOf(player),
    }),
    // Runs the simulation without waiting for real frames, then draws one.
    // Handy for screenshots and for checking the race logic quickly.
    advance(seconds) {
      const dt = 1 / 60;
      for (let i = 0; i < Math.round(seconds / dt); i += 1) {
        lastDelta = dt;
        elapsed += dt;
        if (phase === 'racing') raceTime += dt;
        updateField(dt, elapsed);
        for (const racer of field) placeView(racer);
        updateCamera(dt);
      }
      updateHud();
      renderer.render(scene, camera);
      return this.snapshot();
    },
    snap: () => renderer.domElement.toDataURL('image/png'),
  };
})();