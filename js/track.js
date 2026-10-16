/**
 * track.js
 * --------
 * The circuit, as pure numbers. No three.js and no DOM in here on purpose:
 * the awkward parts of a racing game (splines, lap counting, corner speeds)
 * are exactly the parts worth unit testing, so they live somewhere Node can
 * reach. `tests/track.test.mjs` runs against this file.
 *
 * A position on the track is two numbers: `d`, metres travelled around the
 * loop, and `offset`, metres from the middle of the road. Everything else -
 * where that is in the world, which way you face, how fast you may go - is
 * worked out from those two.
 */

const TAU = Math.PI * 2;

// How the car handles, tuned once so the game and the tests agree.
const STEER_PUSH = 15; // sideways acceleration at full lock, m/s^2
const SELF_CENTRING = 2.2; // how hard the car straightens itself, per second
const GRAVEL_GRIP = 5; // and how much more, off the road

/** A single coordinate of a Catmull-Rom curve between p1 and p2. */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Keeps values in range. */
export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/** Wraps a distance into the loop, so lapping past the line works. */
export function wrap(distance, length) {
  const wrapped = distance % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

/** Shortest signed gap from a to b going forward along the loop, in metres. */
export function forwardGap(a, b, length) {
  return wrap(b - a, length);
}

/**
 * Has the car just passed the start/finish line?
 *
 * Cars start on the grid just *past* the line, so the distance always sits in
 * 0..length and only ever wraps right back round at the end of a lap. (If the
 * grid were placed behind the line, the first wrap would arrive immediately
 * and hand everybody a free lap.)
 */
export function crossedLine(previousD, nextD) {
  return nextD < previousD;
}

/**
 * A car's lap count after one step.
 *
 * Every car goes through this, including the computer karts. Ranking compares
 * `lap * length + d`, so a car whose lap counter is not being updated gets
 * ranked on one lap's worth of distance and never appears to be behind.
 */
export function lapAfterStep(racer, previousD, nextD) {
  return racer.lap + (crossedLine(previousD, nextD) ? 1 : 0);
}

export const DEFAULTS = {
  halfWidth: 9, // metres from the middle to the white line
  runoff: 7, // metres of gravel before the barrier
  maxSpeed: 62, // ~223 km/h
  minSpeed: 14,
  accel: 16, // m/s^2
  brake: 30,
  grip: 24, // sideways acceleration the tyres can hold
  lutSamples: 4000,
};

/**
 * The default circuit: control points around a closed loop.
 *
 * Angles always increase and radii stay positive, which guarantees the spline
 * can never fold back through itself - so there is no way to end up with a
 * track that crosses or doubles over.
 */
export function defaultControlPoints(count = 16) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU;
    const radius = 92 + 24 * Math.sin(2 * angle + 0.7) + 11 * Math.cos(3 * angle - 0.4);
    points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  }
  return points;
}

/**
 * Builds a track from control points.
 * @param {{x:number,z:number}[]} points closed loop, at least 4 points
 * @param {object} options see DEFAULTS
 */
export function createTrack(points, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const n = points.length;
  if (n < 4) throw new Error('a circuit needs at least 4 control points');

  // --- 1. a table of distance at evenly spaced steps around the loop -------
  // This is what turns "metres travelled" into "where am I on the curve".
  const N = cfg.lutSamples;
  const cum = new Float64Array(N + 1);
  let previous = evaluate(points, 0, n);
  for (let i = 1; i <= N; i += 1) {
    const p = evaluate(points, i / N, n);
    cum[i] = cum[i - 1] + Math.hypot(p.x - previous.x, p.z - previous.z);
    previous = p;
  }
  const length = cum[N];
  if (!(length > 0)) throw new Error('the control points made a zero-length loop');

  /** Turns metres into a step round the loop (0..1). */
  function tAtDistance(distance) {
    // Wrap rather than clamp: cars start behind the start line, and the
    // speed limit looks past the finish line, so out-of-range distances are
    // normal, not mistakes.
    const target = wrap(distance, length);
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const upper = Math.max(lo, 1);
    const span = cum[upper] - cum[upper - 1];
    const fraction = span > 0 ? (target - cum[upper - 1]) / span : 0;
    return (upper - 1 + fraction) / N;
  }

  function distanceAtT(t) {
    const wrapped = wrap(t, 1);
    const position = wrapped * N;
    const index = Math.min(Math.floor(position), N - 1);
    return cum[index] + (cum[index + 1] - cum[index]) * (position - index);
  }

  // --- 2. the same table again, but holding how fast you may go -----------
  // Corner speed comes from how tight the corner is: v = sqrt(grip / curvature).
  // Then two passes turn that into a speed you can actually drive: you can
  // never be going faster than you could have braked down to, and never
  // slower than you could have accelerated up to.
  const M = 600;
  const curvatureStep = 5; // metres either side when measuring the bend
  const limits = new Float64Array(M + 1);
  for (let i = 0; i <= M; i += 1) {
    const d = (i / M) * length;
    const ahead = frameAt(d + curvatureStep);
    const behind = frameAt(d - curvatureStep);
    const cross = ahead.tx * behind.tz - ahead.tz * behind.tx;
    const dot = ahead.tx * behind.tx + ahead.tz * behind.tz;
    const angle = Math.abs(Math.atan2(cross, dot));
    const curvature = angle / (2 * curvatureStep);
    limits[i] = curvature > 1e-6 ? clamp(Math.sqrt(cfg.grip / curvature), cfg.minSpeed, cfg.maxSpeed) : cfg.maxSpeed;
  }
  const segment = length / M;
  for (let i = 1; i <= M; i += 1) {
    limits[i] = Math.min(limits[i], Math.sqrt(limits[i - 1] ** 2 + 2 * cfg.accel * segment));
  }
  for (let i = M - 1; i >= 0; i -= 1) {
    limits[i] = Math.min(limits[i], Math.sqrt(limits[i + 1] ** 2 + 2 * cfg.brake * segment));
  }

  function frameAt(distance) {
    const t = tAtDistance(distance);
    const p = evaluate(points, t, n);
    const ahead = evaluate(points, t + 0.0005, n);
    const behind = evaluate(points, t - 0.0005, n);
    let tx = ahead.x - behind.x;
    let tz = ahead.z - behind.z;
    const magnitude = Math.hypot(tx, tz) || 1;
    tx /= magnitude;
    tz /= magnitude;
    return { x: p.x, z: p.z, tx, tz, sx: -tz, sz: tx }; // sx/sz is "left of" the tangent
  }

  /** Where am I, which way am I facing, and which way is off the road. */
  function sample(distance) {
    return frameAt(distance);
  }

  /** The fastest you may be going at this point on the track. */
  function speedLimitAt(distance) {
    const position = (wrap(distance, length) / length) * M;
    const index = Math.min(Math.floor(position), M - 1);
    return limits[index] + (limits[index + 1] - limits[index]) * (position - index);
  }

  /**
   * The lowest limit within `lookahead` metres, so the car starts braking
   * before the corner rather than in it.
   */
  function speedLimitAhead(distance, lookahead = 45) {
    let lowest = cfg.maxSpeed;
    for (let ahead = 0; ahead <= lookahead; ahead += 5) {
      lowest = Math.min(lowest, speedLimitAt(distance + ahead));
    }
    return lowest;
  }

  /** World position of a point on the road. */
  function positionAt(distance, offset = 0) {
    const frame = frameAt(distance);
    return { x: frame.x + frame.sx * offset, z: frame.z + frame.sz * offset };
  }

  /** Which side of the track is "outside" the corner, for scenery. */
  function outwardAt(distance) {
    const frame = frameAt(distance);
    return frame.x * frame.sx + frame.z * frame.sz >= 0 ? 1 : -1;
  }

  return {
    points,
    length,
    halfWidth: cfg.halfWidth,
    runoff: cfg.runoff,
    maxSpeed: cfg.maxSpeed,
    accel: cfg.accel,
    brake: cfg.brake,
    minSpeed: cfg.minSpeed,
    sample,
    positionAt,
    speedLimitAt,
    speedLimitAhead,
    outwardAt,
    tAtDistance,
    distanceAtT,
  };
}

/** Catmull-Rom through a closed loop of points. `t` runs 0..1 over the whole loop. */
function evaluate(points, t, count) {
  const position = wrap(t, 1) * count;
  const index = Math.floor(position);
  const local = position - index;
  const i0 = (index - 1 + count) % count;
  const i1 = index % count;
  const i2 = (index + 1) % count;
  const i3 = (index + 2) % count;
  return {
    x: catmullRom(points[i0].x, points[i1].x, points[i2].x, points[i3].x, local),
    z: catmullRom(points[i0].z, points[i1].z, points[i2].z, points[i3].z, local),
  };
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

/**
 * Moves one car forward by dt seconds.
 *
 * `car` is { d, offset, speed, lateral }; this function is the whole handling
 * model: throttle, brakes, the corner speed limit and sliding off the road.
 *
 * @param {{d:number,offset:number,speed:number,lateral:number}} car
 * @param {number} dt seconds
 * @param {{throttle:number, brake:number, steer:number}} input -1..1
 * @param {object} track from createTrack
 * @returns {{car:object, offTrack:boolean, atLimit:boolean}} a new car object
 */
export function driveCar(car, dt, input, track) {
  const { throttle = 0, brake = 0, steer = 0 } = input ?? {};
  const { d, offset, speed } = car;

  // How fast the corner ahead allows, and what the road surface allows.
  const cornerLimit = track.speedLimitAhead(d);
  const onRoad = Math.abs(offset) <= track.halfWidth;
  const surfaceLimit = onRoad ? track.maxSpeed : track.maxSpeed * 0.55;
  const ceiling = Math.min(cornerLimit, surfaceLimit);

  // Throttle and brakes move the speed towards that ceiling.
  let nextSpeed = speed;
  const wanted = ceiling * clamp(throttle, 0, 1);
  if (speed < wanted) nextSpeed += track.accel * throttle * dt;
  if (brake > 0) nextSpeed -= track.brake * brake * dt;
  // Going faster than the limit? You are already braking, and the harder you
  // are over the limit the harder you brake.
  if (speed > ceiling) nextSpeed -= track.brake * dt * (1 + (speed - ceiling) * 0.4);
  nextSpeed = clamp(nextSpeed, 0, track.maxSpeed);

  // Steering: the wheels push the car sideways, and the tyres pull it back
  // straight again. That is what makes letting go of the wheel feel like
  // letting go, rather than the car sliding forever.
  const authority = clamp(nextSpeed / 10, 0, 1); // no steering when stationary
  let lateral = (car.lateral ?? 0) + steer * STEER_PUSH * authority * dt;
  lateral *= Math.exp(-(onRoad ? SELF_CENTRING : GRAVEL_GRIP) * dt);

  return {
    car: {
      d: wrap(d + nextSpeed * dt, track.length),
      offset: offset + lateral * dt,
      speed: nextSpeed,
      lateral,
    },
    offTrack: !onRoad,
    atLimit: nextSpeed >= ceiling - 0.5,
  };
}

/**
 * Lap and gap arithmetic.
 * @param {{lap:number, d:number}} racer
 * @returns {number} metres covered since the start, for ranking
 */
export function progress(racer, track) {
  return racer.lap * track.length + racer.d;
}

/** Position on the grid, 1 = leading. Ties share a place. */
export function racePositions(racers, track) {
  return racers
    .map((racer) => ({ racer, covered: progress(racer, track) }))
    .sort((a, b) => b.covered - a.covered)
    .map((entry, index, all) => ({
      racer: entry.racer,
      place: index > 0 && Math.abs(entry.covered - all[index - 1].covered) < 0.001 ? all[index - 1].place : index + 1,
    }));
}

/** Seconds as m:ss, for the HUD and the leaderboard. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--.-';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}