/**
 * character.js
 * ------------
 * Turns a start.ng character `style` into a low-poly 3D character made of boxes
 * and spheres.
 *
 * This is the whole point of the game: the player never picks a look here.
 * start.ng owns the look (colours, hair, hat, accessory) and sends it to us in
 * `style`. If start.ng adds a new hairstyle later, add it to the switch below
 * and this game can show it too.
 */

import * as THREE from 'three';

const DEFAULTS = {
  body: 'female',
  primaryColor: '#d8fd71',
  secondaryColor: '#3d5a3d',
  skinColor: '#8d5524',
  hairColor: '#17120f',
  hair: 'short',
  hat: 'none',
  accessory: 'none',
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(0.5, 16, 12);

/** Only accept colours start.ng would send, so a bad value can never crash the game. */
function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? value : fallback;
}

/** Flat-shaded material: matches the chunky low-poly look. */
function matte(hex, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.85, ...extra });
}

/**
 * Every builder below returns a real Mesh (never `scale.set()`, which returns
 * a Vector3 and would quietly break scene.add).
 */
function part(geometry, material, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A stretched box. sx/sy/sz are the full width, height and depth. */
const box = (material, sx, sy, sz, x = 0, y = 0, z = 0) => part(BOX, material, sx, sy, sz, x, y, z);

/** A sphere stretched to an ellipsoid. */
const ball = (material, sx, sy, sz, x = 0, y = 0, z = 0) => part(SPHERE, material, sx, sy, sz, x, y, z);

/**
 * Builds the character.
 * @param {object} style  start.ng's style object
 * @param {string} name   the character's name, shown floating above their head
 * @param {string} pose   'stand' or 'sit' (driving a kart)
 * @returns {{ group: THREE.Group, update: (dt:number, speed:number)=>void, setSteer: (n:number)=>void }}
 */
export function createCharacter(style = {}, name = 'Player', pose = 'stand') {
  const s = { ...DEFAULTS, ...style };
  const skin = matte(color(s.skinColor, DEFAULTS.skinColor));
  const top = matte(color(s.primaryColor, DEFAULTS.primaryColor));
  const bottom = matte(color(s.secondaryColor, DEFAULTS.secondaryColor));
  const hair = matte(color(s.hairColor, DEFAULTS.hairColor));

  const feminine = s.body === 'female';
  const group = new THREE.Group();
  const body = new THREE.Group(); // everything inside here bobs while walking
  group.add(body);

  // ---- legs -------------------------------------------------------------
  // legL/legR are pivots at the hip, so rotating them swings the legs.
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.17, 0.82, 0);
  legR.position.set(0.17, 0.82, 0);
  legL.add(box(bottom, 0.2, 0.82, 0.2, 0, -0.41, 0));
  legR.add(box(bottom, 0.2, 0.82, 0.2, 0, -0.41, 0));
  body.add(legL, legR);

  // ---- hips / skirt -----------------------------------------------------
  body.add(box(bottom, 0.52, 0.22, 0.3, 0, 0.86, 0));
  if (feminine) {
    // start.ng says secondaryColor is "trousers or skirt", so this one wears a skirt.
    body.add(part(new THREE.CylinderGeometry(0.24, 0.42, 0.5, 12), bottom, 1, 1, 1, 0, 0.66, 0));
  }

  // ---- torso + arms -----------------------------------------------------
  const shoulderWidth = feminine ? 0.54 : 0.62;
  body.add(box(top, shoulderWidth, 0.66, 0.34, 0, 1.22, 0));

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-shoulderWidth / 2 - 0.09, 1.48, 0);
  armR.position.set(shoulderWidth / 2 + 0.09, 1.48, 0);
  armL.add(box(top, 0.15, 0.58, 0.15, 0, -0.28, 0));
  armR.add(box(top, 0.15, 0.58, 0.15, 0, -0.28, 0));
  body.add(armL, armR);

  addBodyAccessory(body, s.accessory, bottom);

  // ---- head -------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 1.78, 0);
  head.add(box(skin, 0.42, 0.42, 0.4));

  // eyes, so you can tell which way your character is facing
  const eye = matte('#17120f', { roughness: 0.4 });
  head.add(box(eye, 0.07, 0.09, 0.03, -0.09, 0.02, 0.2));
  head.add(box(eye, 0.07, 0.09, 0.03, 0.09, 0.02, 0.2));

  addHair(head, s.hair, hair);
  addHat(head, s.hat);
  addFaceAccessory(head, s.accessory, hair);
  body.add(head);

  // ---- floating name ----------------------------------------------------
  const label = makeNameLabel(name);
  label.position.set(0, 2.4, 0);
  label.visible = pose === 'stand'; // a seated driver needs no name tag
  group.add(label);

  // ---- pose -------------------------------------------------------------
  if (pose === 'sit') {
    // Behind the wheel: knees bent forward to the pedals, arms to the wheel.
    legL.rotation.x = -1.35;
    legR.rotation.x = -1.35;
    legL.position.y = 0.6;
    legR.position.y = 0.6;
    armL.rotation.x = -1.2;
    armR.rotation.x = -1.2;
    armL.position.y = 1.34;
    armR.position.y = 1.34;
  }

  // ---- animation --------------------------------------------------------
  let phase = 0;

  /** @param {number} dt seconds @param {number} speed current ground speed */
  function update(dt, speed) {
    if (pose === 'sit') {
      // Sitting: no walk cycle, just a little bob from the engine.
      phase += dt * speed * 0.55;
      body.position.y = Math.sin(phase * 3) * Math.min(speed / 40, 1) * 0.02;
      return;
    }
    const moving = Math.min(speed / 6, 1);
    phase += dt * (2 + speed * 2.2);
    const swing = Math.sin(phase) * moving * 0.6;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
    body.position.y = Math.abs(Math.sin(phase)) * moving * 0.06;
  }

  /** Turns the front wheel -1..1, so the driver actually holds the steering. */
  function setSteer(amount) {
    const lean = -0.45 * amount;
    armL.rotation.y = lean;
    armR.rotation.y = lean;
  }

  return { group, update, setSteer };
}

// ---------------------------------------------------------------------------
// Hair (on the head)
// ---------------------------------------------------------------------------
function addHair(head, style, material) {
  switch (style) {
    case 'afro':
      head.add(ball(material, 0.62, 0.58, 0.6, 0, 0.12, -0.03));
      break;
    case 'bun':
      head.add(box(material, 0.44, 0.14, 0.42, 0, 0.19, 0));
      head.add(ball(material, 0.26, 0.26, 0.26, 0, 0.3, -0.24));
      break;
    case 'ponytail':
      head.add(box(material, 0.44, 0.14, 0.42, 0, 0.19, 0));
      head.add(box(material, 0.16, 0.5, 0.16, 0, -0.04, -0.26));
      break;
    case 'braids':
      head.add(box(material, 0.44, 0.14, 0.42, 0, 0.19, 0));
      for (const x of [-0.17, 0, 0.17]) head.add(box(material, 0.1, 0.42, 0.1, x, -0.12, -0.2));
      break;
    case 'dreads':
      head.add(box(material, 0.44, 0.14, 0.42, 0, 0.19, 0));
      for (const x of [-0.18, -0.09, 0, 0.09, 0.18]) head.add(box(material, 0.09, 0.34, 0.09, x, -0.06, -0.21));
      break;
    case 'bald':
      break;
    case 'short':
    default:
      head.add(box(material, 0.44, 0.16, 0.42, 0, 0.19, -0.02));
      break;
  }
}

// ---------------------------------------------------------------------------
// Hats (on the head)
// ---------------------------------------------------------------------------
function addHat(head, style) {
  switch (style) {
    case 'cap': {
      const cap = matte('#3f6fd8');
      head.add(ball(cap, 0.46, 0.3, 0.44, 0, 0.14, -0.02));
      head.add(box(cap, 0.42, 0.05, 0.2, 0, 0.13, 0.24));
      break;
    }
    case 'beanie': {
      const beanie = matte('#e2574c');
      head.add(ball(beanie, 0.48, 0.42, 0.46, 0, 0.16, -0.02));
      break;
    }
    case 'tophat': {
      const felt = matte('#241f1f', { roughness: 0.6 });
      head.add(part(new THREE.CylinderGeometry(0.21, 0.21, 0.34, 12), felt, 1, 1, 1, 0, 0.34, 0));
      head.add(part(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16), felt, 1, 1, 1, 0, 0.19, 0));
      break;
    }
    case 'crown': {
      const gold = matte('#ffd24a', { roughness: 0.35, metalness: 0.4 });
      head.add(part(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 14), gold, 1, 1, 1, 0, 0.25, 0));
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        head.add(
          part(new THREE.ConeGeometry(0.05, 0.16, 6), gold, 1, 1, 1, Math.cos(angle) * 0.2, 0.37, Math.sin(angle) * 0.2)
        );
      }
      break;
    }
    case 'none':
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Accessories that go on the head
// ---------------------------------------------------------------------------
function addFaceAccessory(head, style, hair) {
  const metal = matte('#1b1b1b', { roughness: 0.4, metalness: 0.3 });
  switch (style) {
    case 'glasses':
      for (const x of [-0.09, 0.09]) {
        head.add(part(new THREE.TorusGeometry(0.075, 0.014, 8, 16), metal, 1, 1, 1, x, 0.02, 0.21));
      }
      head.add(box(metal, 0.06, 0.02, 0.02, 0, 0.02, 0.21));
      break;
    case 'earrings':
      for (const x of [-0.22, 0.22]) {
        head.add(part(new THREE.TorusGeometry(0.05, 0.014, 8, 14), metal, 1, 1, 1, x, -0.06, 0));
      }
      break;
    case 'beard':
      head.add(box(hair, 0.4, 0.2, 0.36, 0, -0.14, 0.06));
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Accessories that go on the body
// ---------------------------------------------------------------------------
function addBodyAccessory(body, style, bottom) {
  switch (style) {
    case 'scarf':
      body.add(part(new THREE.TorusGeometry(0.24, 0.07, 8, 20), bottom, 1, 1, 1, 0, 1.56, 0).rotateX(Math.PI / 2));
      body.add(box(bottom, 0.16, 0.4, 0.1, 0.14, 1.38, 0.18));
      break;
    case 'backpack':
      body.add(box(bottom, 0.42, 0.44, 0.22, 0, 1.22, -0.28));
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Name label floating above the character
// ---------------------------------------------------------------------------
function makeNameLabel(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(6, 24, 500, 76, 38);
  ctx.fill();
  ctx.fillStyle = '#fffefa';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(name).slice(0, 18), 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.renderOrder = 10;
  return sprite;
}