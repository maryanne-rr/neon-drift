/**
 * world.js
 * --------
 * Turns the numbers in track.js into something you can look at: the road, the
 * gravel either side, the barriers, the start line, the trees, the grandstands
 * and the sky.
 *
 * Every texture here is drawn onto a canvas at load time, so the repo stays
 * small and nothing loads from the internet.
 */

import * as THREE from 'three';

/** Deterministic random numbers, so the scenery is the same every time you load. */
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A canvas texture from a drawing function. */
function texture(width, height, draw, { repeat = null, wrap = THREE.RepeatWrapping } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = wrap;
  if (repeat) result.repeat.set(repeat[0], repeat[1]);
  result.anisotropy = 4;
  return result;
}

/** Flat colour with a little speckle, so big surfaces are not dead flat. */
function speckled(ctx, width, height, base, spots) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  for (const [count, colour, size] of spots) {
    ctx.fillStyle = colour;
    for (let i = 0; i < count; i += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = size * (0.4 + Math.random());
      ctx.fillRect(x, y, r, r);
    }
  }
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
const asphaltTexture = () =>
  texture(
    512,
    512,
    (ctx, w, h) => {
      speckled(ctx, w, h, '#2f3134', [
        [900, '#34363a', 3],
        [500, '#282a2d', 4],
      ]);
      // white lines just inside each edge
      ctx.fillStyle = '#e8e6dc';
      ctx.fillRect(10, 0, 9, h);
      ctx.fillRect(w - 19, 0, 9, h);
      // dashed centre line: two dashes per 12 metre tile
      ctx.fillStyle = 'rgba(232,230,220,0.75)';
      ctx.fillRect(w / 2 - 5, 40, 10, 130);
      ctx.fillRect(w / 2 - 5, 320, 10, 130);
    },
    { repeat: [1, 1] }
  );

const gravelTexture = () =>
  texture(256, 256, (ctx, w, h) => {
    speckled(ctx, w, h, '#6d6555', [
      [700, '#7d7561', 4],
      [400, '#5b5446', 5],
    ]);
  });

const barrierTexture = () =>
  texture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#e7e3d8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8484a';
    ctx.fillRect(0, 0, w, 16);
    ctx.fillRect(0, h - 16, w, 16);
  });

const checkerTexture = () =>
  texture(128, 128, (ctx, w, h) => {
    const cells = 8;
    const size = w / cells;
    for (let x = 0; x < cells; x += 1) {
      for (let y = 0; y < cells; y += 1) {
        ctx.fillStyle = (x + y) % 2 ? '#f4f2ea' : '#20211d';
        ctx.fillRect(x * size, y * size, size, size);
      }
    }
  });

const skyTexture = () =>
  texture(16, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#101a33');
    gradient.addColorStop(0.55, '#3b4a6b');
    gradient.addColorStop(0.78, '#8f7f7a');
    gradient.addColorStop(1, '#d6b489');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }, { wrap: THREE.ClampToEdgeWrapping });

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A flat ribbon of road between two offsets from the centre line. */
function roadStrip(track, offsetA, offsetB, y, uvMetres) {
  // Always build from the smaller offset to the larger one, so the winding
  // below is the same for both sides of the track and the surface faces up.
  const near = Math.min(offsetA, offsetB);
  const far = Math.max(offsetA, offsetB);

  const rings = Math.ceil(track.length / 2);
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= rings; i += 1) {
    const d = (i / rings) * track.length;
    const a = track.positionAt(d, near);
    const b = track.positionAt(d, far);
    positions.push(a.x, y, a.z, b.x, y, b.z);
    const v = d / uvMetres;
    uvs.push(0, v, 1, v);
  }
  // Wound so the face normal points up (+y), otherwise three.js hides it.
  for (let i = 0; i < rings; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A vertical wall along one side of the track. */
function barrierWall(track, offset, height) {
  const rings = Math.ceil(track.length / 3);
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= rings; i += 1) {
    const d = (i / rings) * track.length;
    const edge = track.positionAt(d, offset);
    positions.push(edge.x, 0, edge.z, edge.x, height, edge.z);
    const v = d / 8;
    uvs.push(0, v, 0, v);
  }
  for (let i = 0; i < rings; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------
export function buildWorld(scene, track) {
  const random = seededRandom(20261016);
  const outer = track.halfWidth + track.runoff;

  scene.fog = new THREE.Fog('#c0a68a', 180, 620);

  // ---- sky dome ---------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false })
  );
  scene.add(sky);

  // ---- ground -----------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(880, 48),
    new THREE.MeshStandardMaterial({ color: '#4c5a3a', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.35;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- road, gravel, barriers ------------------------------------------
  const road = new THREE.Mesh(
    roadStrip(track, -track.halfWidth, track.halfWidth, 0.01, 12),
    // DoubleSide so the surface can never disappear because of triangle
    // winding; three.js flips the normal for back faces, so it still lights up.
    new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, side: THREE.DoubleSide })
  );
  road.receiveShadow = true;
  scene.add(road);

  const gravelMaterial = new THREE.MeshStandardMaterial({
    map: gravelTexture(),
    roughness: 1,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const gravel = new THREE.Mesh(
      roadStrip(track, side * track.halfWidth, side * outer, -0.02, 8),
      gravelMaterial
    );
    gravel.receiveShadow = true;
    scene.add(gravel);

    const wall = new THREE.Mesh(
      barrierWall(track, side * outer, 1.25),
      new THREE.MeshStandardMaterial({ map: barrierTexture(), side: THREE.DoubleSide, roughness: 0.7 })
    );
    scene.add(wall);
  }

  // ---- start and finish line -------------------------------------------
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(track.halfWidth * 2, 3),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.9 })
  );
  const startEdge = track.positionAt(0, 0);
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(track.sample(0).tx, track.sample(0).tz);
  line.position.set(startEdge.x, 0.04, startEdge.z);
  scene.add(line);

  // ---- start gantry -----------------------------------------------------
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.5, metalness: 0.4 });
  const sign = new THREE.MeshStandardMaterial({ color: '#d8fd71', emissive: '#7a922c', emissiveIntensity: 0.5, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7, 8), steel);
    post.position.set(0, 3.5, side * (outer + 0.6));
    post.castShadow = true;
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, (outer + 0.6) * 2), sign);
  beam.position.set(0, 7.4, 0);
  gantry.add(beam);
  gantry.position.set(startEdge.x, 0, startEdge.z);
  gantry.rotation.y = Math.atan2(track.sample(0).tx, track.sample(0).tz) + Math.PI / 2;
  scene.add(gantry);

  // ---- scenery ----------------------------------------------------------
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#4a3524', flatShading: true, roughness: 1 });
  const leafMaterials = ['#2f5d34', '#3a6b34', '#27502f'].map(
    (colour) => new THREE.MeshStandardMaterial({ color: colour, flatShading: true, roughness: 1 })
  );
  const rockMaterial = new THREE.MeshStandardMaterial({ color: '#7d7a72', flatShading: true, roughness: 1 });

  // Trees and rocks along both sides. They give the corners something to
  // sweep past, which is most of what sells the speed.
  for (let d = 0; d < track.length; d += 11) {
    const outward = track.outwardAt(d);
    for (const side of [-1, 1]) {
      if (random() > 0.55) continue;
      const beyond = 3 + random() * 34;
      const frame = track.sample(d + random() * 6);
      const x = frame.x + frame.sx * side * (outer + beyond);
      const z = frame.z + frame.sz * side * (outer + beyond);

      if (random() < 0.72) {
        const scale = 0.8 + random() * 0.9;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 2.4, 6), trunkMaterial);
        trunk.position.y = 1.2;
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.7, 4.2, 7), leafMaterials[Math.floor(random() * 3)]);
        crown.position.y = 3.6;
        crown.castShadow = true;
        tree.add(trunk, crown);
        tree.scale.setScalar(scale);
        tree.position.set(x, 0, z);
        tree.rotation.y = random() * Math.PI;
        scene.add(tree);
      } else {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + random() * 1.4, 0), rockMaterial);
        rock.position.set(x, 0.3, z);
        rock.rotation.set(random() * 3, random() * 3, random() * 3);
        rock.castShadow = true;
        scene.add(rock);
      }
    }
  }

  // Advertising boards along the barriers, like a real circuit.
  const boardColours = ['#e2574c', '#5aa9ff', '#ffd24a', '#f2f0e6', '#7ad7ff'];
  for (let d = 20; d < track.length - 20; d += 46) {
    const outward = track.outwardAt(d);
    const frame = track.sample(d);
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 1.1, 7),
        new THREE.MeshStandardMaterial({
          color: boardColours[Math.floor(random() * boardColours.length)],
          roughness: 0.8,
        })
      );
      board.position.set(
        frame.x + frame.sx * side * (outer + 0.35),
        1.3,
        frame.z + frame.sz * side * (outer + 0.35)
      );
      board.lookAt(board.position.clone().add(new THREE.Vector3(frame.x, 0, frame.z)));
      scene.add(board);
    }
  }

  // Grandstands opposite the start line.
  const standMaterial = new THREE.MeshStandardMaterial({ color: '#8d8f96', roughness: 0.85 });
  const crowdTexture = texture(64, 32, (ctx, w, h) => {
    const random2 = seededRandom(7);
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = `hsl(${Math.floor(random2() * 360)}, 45%, ${45 + random2() * 25}%)`;
        ctx.fillRect(x, y, 3, 3);
      }
    }
  });
  const startFrame = track.sample(0);
  for (const side of [-1, 1]) {
    const stand = new THREE.Group();
    const tiers = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 4), standMaterial);
    tiers.position.y = 4.5;
    tiers.castShadow = true;
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 3),
      new THREE.MeshStandardMaterial({ map: crowdTexture })
    );
    crowd.position.set(0, 6.5, side > 0 ? -2.05 : 2.05);
    if (side < 0) crowd.rotation.y = Math.PI;
    stand.add(tiers, crowd);
    stand.position.set(
      startFrame.x + startFrame.sx * side * (outer + 16),
      0,
      startFrame.z + startFrame.sz * side * (outer + 16)
    );
    stand.rotation.y = Math.atan2(startFrame.tx, startFrame.tz);
    scene.add(stand);
  }

  // Mountains on the horizon, so the world does not just stop.
  const mountainMaterial = new THREE.MeshStandardMaterial({ color: '#5c5f6b', flatShading: true, roughness: 1 });
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * Math.PI * 2 + random() * 0.1;
    const distance = 430 + random() * 180;
    const height = 60 + random() * 120;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(90 + random() * 80, height, 5), mountainMaterial);
    mountain.position.set(Math.cos(angle) * distance, height / 2 - 8, Math.sin(angle) * distance);
    mountain.rotation.y = random() * Math.PI;
    scene.add(mountain);
  }

  return { outer };
}