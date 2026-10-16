/**
 * kart.js
 * -------
 * A kart built out of boxes and cylinders - no model files, so the whole game
 * stays a few hundred kilobytes and needs nothing from the internet.
 *
 * The player's kart carries the driver's start.ng character. The three
 * computer karts get made-up characters in the same style, so the grid looks
 * like it belongs on start.ng without pretending they are real accounts.
 */

import * as THREE from 'three';
import { createCharacter } from './character.js';

const WHEEL_RADIUS = 0.36;

function paint(hex, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.5, metalness: 0.1, ...extra });
}

function box(material, sx, sy, sz, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function tyre() {
  const geometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 18).rotateZ(Math.PI / 2);
  return new THREE.MeshStandardMaterial({ color: '#1d1d1f', flatShading: true, roughness: 0.9 });
}

/**
 * @param {object} options
 * @param {string} options.color    body colour
 * @param {string} options.accent   wing and stripe colour
 * @param {object} [options.style]  a start.ng style for the driver
 * @param {string} [options.name]   driver name
 * @returns {{group:THREE.Group, setSteer:Function, spin:Function, character:object|null}}
 */
export function createKart({ color = '#d8fd71', accent = '#2b2f4a', style = null, name = 'Driver' } = {}) {
  const group = new THREE.Group();
  const body = paint(color);
  const trim = paint(accent);
  const rubber = tyre();
  const glow = new THREE.MeshStandardMaterial({
    color: '#fff4d6',
    emissive: '#ffe9a8',
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });

  // ---- chassis ----------------------------------------------------------
  group.add(box(body, 1.5, 0.3, 2.7, 0, 0.36, 0)); // main tub
  group.add(box(trim, 1.9, 0.1, 2.3, 0, 0.2, 0)); // floor pan
  group.add(box(body, 0.86, 0.26, 0.9, 0, 0.32, 1.5)); // nose
  group.add(box(body, 0.28, 0.3, 1.5, -0.82, 0.36, 0.1)); // sidepods
  group.add(box(body, 0.28, 0.3, 1.5, 0.82, 0.36, 0.1));
  group.add(box(trim, 0.55, 0.44, 0.55, 0, 0.55, -1.0)); // engine behind the seat

  // ---- seat and wheel ---------------------------------------------------
  group.add(box(trim, 0.86, 0.62, 0.16, 0, 0.78, -0.52)); // seat back
  const steering = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 18), trim);
  steering.position.set(0, 0.84, 0.3);
  steering.rotation.x = -0.45;
  group.add(steering);

  // ---- rear wing --------------------------------------------------------
  group.add(box(trim, 1.5, 0.08, 0.42, 0, 1.06, -1.28));
  group.add(box(trim, 0.08, 0.34, 0.08, -0.6, 0.9, -1.28));
  group.add(box(trim, 0.08, 0.34, 0.08, 0.6, 0.9, -1.28));

  // ---- lights and exhaust ----------------------------------------------
  group.add(box(glow, 0.26, 0.16, 0.1, -0.38, 0.42, 1.92));
  group.add(box(glow, 0.26, 0.16, 0.1, 0.38, 0.42, 1.92));
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8), trim);
  exhaust.position.set(0.36, 0.72, -1.2);
  exhaust.rotation.x = Math.PI / 2;
  group.add(exhaust);

  // ---- wheels -----------------------------------------------------------
  const front = [];
  const rear = [];
  for (const side of [-1, 1]) {
    // Each front wheel sits in a group, so the group can turn for steering.
    const steerGroup = new THREE.Group();
    steerGroup.position.set(0.86 * side, WHEEL_RADIUS, 1.0);
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 18).rotateZ(Math.PI / 2),
      rubber
    );
    wheel.castShadow = true;
    steerGroup.add(wheel);
    group.add(steerGroup);
    front.push({ steerGroup, wheel });

    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(WHEEL_RADIUS * 1.12, WHEEL_RADIUS * 1.12, 0.38, 18).rotateZ(Math.PI / 2),
      rubber
    );
    back.position.set(0.9 * side, WHEEL_RADIUS * 1.12, -0.95);
    back.castShadow = true;
    group.add(back);
    rear.push(back);
  }

  // ---- the driver -------------------------------------------------------
  let character = null;
  if (style) {
    character = createCharacter(style, name, 'sit');
    character.group.scale.setScalar(0.62);
    character.group.position.set(0, 0.42, -0.18);
    group.add(character.group);
  }

  let spinAngle = 0;

  /** Turns the front wheels and the driver's arms. */
  function setSteer(amount) {
    for (const { steerGroup } of front) steerGroup.rotation.y = -0.42 * amount;
    character?.setSteer(amount);
  }

  /** Spins the wheels, faster the quicker you are going. */
  function spin(speed, dt) {
    spinAngle -= (speed / WHEEL_RADIUS) * dt;
    for (const { wheel } of front) wheel.rotation.x = spinAngle;
    for (const wheel of rear) wheel.rotation.x = spinAngle;
  }

  return { group, setSteer, spin, character };
}

/** A handful of made-up characters so the computer karts are not empty. */
const RIVAL_STYLES = [
  { body: 'male', primaryColor: '#e2574c', secondaryColor: '#2b2f4a', skinColor: '#6f4423', hairColor: '#17120f', hair: 'short', hat: 'cap', accessory: 'none' },
  { body: 'female', primaryColor: '#5aa9ff', secondaryColor: '#20304a', skinColor: '#c68642', hairColor: '#3a2415', hair: 'ponytail', hat: 'none', accessory: 'glasses' },
  { body: 'male', primaryColor: '#f2f0e6', secondaryColor: '#3d3f52', skinColor: '#4a2c17', hairColor: '#17120f', hair: 'dreads', hat: 'none', accessory: 'beard' },
];

const RIVAL_COLORS = [
  { color: '#e2574c', accent: '#f2f0e6' },
  { color: '#5aa9ff', accent: '#20304a' },
  { color: '#f2f0e6', accent: '#e2574c' },
];

/** Builds one computer kart. @param {number} index 0..2 */
export function createRivalKart(index) {
  return createKart({
    ...RIVAL_COLORS[index % RIVAL_COLORS.length],
    style: RIVAL_STYLES[index % RIVAL_STYLES.length],
    name: 'Rival',
  });
}