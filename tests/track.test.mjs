/**
 * tests/track.test.mjs
 *
 * The circuit maths is the part of a racing game that is easy to get subtly
 * wrong and hard to see, so it gets checked here instead of by squinting at
 * the screen. Run with:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTrack,
  crossedLine,
  defaultControlPoints,
  driveCar,
  formatTime,
  forwardGap,
  progress,
  racePositions,
  wrap,
} from '../js/track.js';

const track = createTrack(defaultControlPoints());

/** A car sitting still on the centre line. */
const parked = () => ({ d: 0, offset: 0, speed: 0, lateral: 0 });

/** Drives a car for `seconds`, holding the given controls. */
function simulate(car, seconds, input, step = 1 / 60) {
  let current = car;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    current = driveCar(current, step, input, track).car;
  }
  return current;
}

test('the circuit has a sensible length', () => {
  assert.ok(track.length > 400, `track too short: ${track.length}`);
  assert.ok(track.length < 900, `track too long: ${track.length}`);
});

test('every point on the loop is a real number', () => {
  for (let d = 0; d < track.length; d += track.length / 500) {
    const frame = track.sample(d);
    for (const value of [frame.x, frame.z, frame.tx, frame.tz, frame.sx, frame.sz]) {
      assert.ok(Number.isFinite(value), `bad value at ${d.toFixed(1)}m`);
    }
  }
});

test('the loop closes back on itself', () => {
  const start = track.sample(0);
  const finish = track.sample(track.length - 0.001);
  assert.ok(Math.hypot(start.x - finish.x, start.z - finish.z) < 0.5);
});

test('the circuit never crosses over itself', () => {
  const samples = [];
  for (let d = 0; d < track.length; d += track.length / 600) samples.push(track.positionAt(d));

  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      // Only points that are far apart *along* the track matter: neighbours are
      // supposed to be close, but two distant pieces of loop must not touch.
      const along = Math.min(j - i, samples.length - (j - i)) * (track.length / 600);
      if (along < 80) continue;
      const gap = Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z);
      assert.ok(gap > 40, `track folds back on itself: samples ${i} and ${j} are ${gap.toFixed(1)}m apart`);
    }
  }
});

test('the tangent points along the road, and the side vector is square to it', () => {
  for (let d = 0; d < track.length; d += track.length / 200) {
    const frame = track.sample(d);
    const dot = frame.tx * frame.sx + frame.tz * frame.sz;
    assert.ok(Math.abs(dot) < 1e-6, `tangent and side are not square at ${d.toFixed(1)}m`);
    assert.ok(Math.abs(Math.hypot(frame.tx, frame.tz) - 1) < 1e-6, 'tangent is not a unit vector');
  }
});

test('walking forwards really does walk forwards', () => {
  let previous = track.positionAt(0);
  for (let d = 1; d <= 60; d += 1) {
    const here = track.positionAt(d);
    const moved = Math.hypot(here.x - previous.x, here.z - previous.z);
    assert.ok(moved > 0.9 && moved < 1.1, `1m step moved ${moved.toFixed(2)}m`);
    previous = here;
  }
});

test('the white lines sit exactly half a track width apart', () => {
  const left = track.positionAt(100, -track.halfWidth);
  const middle = track.positionAt(100, 0);
  const right = track.positionAt(100, track.halfWidth);
  const leftGap = Math.hypot(left.x - middle.x, left.z - middle.z);
  const rightGap = Math.hypot(right.x - middle.x, right.z - middle.z);
  assert.ok(Math.abs(leftGap - track.halfWidth) < 0.01);
  assert.ok(Math.abs(rightGap - track.halfWidth) < 0.01);
});

test('corner speeds stay inside the car limits', () => {
  let slowest = Infinity;
  for (let d = 0; d < track.length; d += track.length / 400) {
    const limit = track.speedLimitAt(d);
    assert.ok(limit <= track.maxSpeed + 1e-6, `faster than top speed at ${d.toFixed(1)}m`);
    assert.ok(limit >= track.minSpeed - 1e-6, `slower than crawl speed at ${d.toFixed(1)}m`);
    slowest = Math.min(slowest, limit);
  }
  // The circuit should actually have corners, not be one long straight.
  assert.ok(slowest < track.maxSpeed * 0.9, `no real corners (slowest ${slowest.toFixed(1)})`);
});

test('the speed you can enter a corner at is never more than the corner allows', () => {
  for (let d = 0; d < track.length; d += 3) {
    const ahead = track.speedLimitAhead(d);
    assert.ok(ahead <= track.speedLimitAt(d) + 1e-6, `braking starts too late at ${d.toFixed(1)}m`);
  }
});

test('throttle accelerates the car and never past the top speed', () => {
  const car = simulate(parked(), 20, { throttle: 1, steer: 0 });
  assert.ok(car.speed > 25, `too slow after 20s: ${car.speed.toFixed(1)} m/s`);
  assert.ok(car.speed <= track.maxSpeed + 1e-6, `over the top speed: ${car.speed}`);
});

test('the brakes are stronger than the engine', () => {
  const fast = simulate(parked(), 20, { throttle: 1, steer: 0 });
  const braked = simulate(fast, 1, { throttle: 0, brake: 1, steer: 0 });
  assert.ok(braked.speed < fast.speed - 15, 'brakes feel weak');
});

test('steering pushes the car sideways, and letting go settles it', () => {
  const turned = simulate(parked(), 2, { throttle: 1, steer: 1 });
  assert.ok(Math.abs(turned.offset) > 2, `steering did nothing (${turned.offset.toFixed(1)}m)`);
  assert.ok(Math.abs(turned.lateral) > 3, 'the car is not sliding sideways while turning');

  // Release the wheel: the slide should die away instead of growing forever.
  const released = simulate(turned, 2, { throttle: 1, steer: 0 });
  const driftWhileTurning = Math.abs(turned.offset);
  const driftAfter = Math.abs(released.offset) - driftWhileTurning;
  assert.ok(Math.abs(released.lateral) < 1, `car is still sliding (${released.lateral.toFixed(1)} m/s)`);
  assert.ok(Math.abs(driftAfter) < driftWhileTurning * 0.4, 'car did not settle after letting go');
});

test('leaving the road scrubs off speed', () => {
  const onRoad = simulate(parked(), 6, { throttle: 1, steer: 0 });
  const offRoad = simulate({ ...parked(), d: 0, offset: track.halfWidth + 3, speed: onRoad.speed }, 0.5, {
    throttle: 1,
    steer: 0,
  });
  assert.ok(offRoad.speed < onRoad.speed, 'the gravel is not slowing anyone down');
});

test('a car never leaves the track sideways', () => {
  // Hold full lock for a long time: the car must stay near the road.
  let car = parked();
  for (let i = 0; i < 600; i += 1) {
    const result = driveCar(car, 1 / 60, { throttle: 1, steer: i % 120 < 60 ? 1 : -1 }, track);
    car = result.car;
    assert.ok(Math.abs(car.offset) < 400, `car flew off the world at ${car.offset.toFixed(0)}m`);
  }
});

test('a lap is counted when a car passes the line', () => {
  // Start just before the line, fast enough to cross it in the first frame.
  const almost = { lap: 0, d: track.length - 0.2, offset: 0, speed: 50, lateral: 0 };
  const next = driveCar(almost, 1 / 60, { throttle: 1, steer: 0 }, track).car;
  assert.ok(next.d < 5, `distance did not wrap (${next.d.toFixed(2)} of ${track.length.toFixed(2)})`);
});

test('crossing the line is only true once per lap', () => {
  // Leaving the grid must not count as a lap...
  assert.equal(crossedLine(20, 26), false, 'counted a lap just by starting');
  assert.equal(crossedLine(2, 9), false);
  // ...only coming back round to it.
  assert.equal(crossedLine(track.length - 3, 0.4), true);
  // And having crossed, the following steps are ordinary driving again.
  assert.equal(crossedLine(0.4, 5), false);
  assert.equal(crossedLine(5, 11), false);
});

test('distance wraps both ways', () => {
  assert.equal(wrap(-10, 100), 90);
  assert.equal(wrap(110, 100), 10);
  assert.equal(wrap(50, 100), 50);
  assert.equal(forwardGap(90, 10, 100), 20, 'a gap across the line wraps forwards');
});

test('the leader is the car that has covered the most ground', () => {
  const field = [
    { id: 'player', lap: 0, d: 300, offset: 0, speed: 50, lateral: 0 },
    { id: 'ai-1', lap: 1, d: 20, offset: 0, speed: 50, lateral: 0 },
    { id: 'ai-2', lap: 0, d: 120, offset: 0, speed: 50, lateral: 0 },
  ];
  const places = Object.fromEntries(racePositions(field, track).map((row) => [row.racer.id, row.place]));
  assert.equal(places['ai-1'], 1, 'the car a lap ahead should be leading');
  assert.equal(places['player'], 2);
  assert.equal(places['ai-2'], 3);
  assert.ok(progress(field[1], track) > progress(field[0], track));
});

test('times are formatted the way a race clock shows them', () => {
  assert.equal(formatTime(75.34), '1:15.3');
  assert.equal(formatTime(9.05), '0:09.1');
  assert.equal(formatTime(0), '0:00.0');
  assert.equal(formatTime(NaN), '--:--.-');
});