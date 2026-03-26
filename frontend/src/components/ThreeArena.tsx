// ============================================================================
// THREE ARENA — 3D Hex Grid Arena (Drop-in replacement for flat CSS arena)
// ============================================================================
// Usage:
//   <ThreeArena
//     isPlayerArena={true}
//     arenaData={gameState.playerArena}
//     shots={gameState.opponentShots}
//     validCells={gameState.validCells}
//     gamePhase={multiplayer.gamePhase}
//     currentHerdCells={gameState.currentHerdCells}
//     onCellClick={(row, col) => handleClick(row, col)}
//     overlayText="Opponent's Turn"
//     overlaySubtext="Waiting..."
//     showOverlay={false}
//     opponentName="Player2"
//     title="Your Herd"
//   />
// ============================================================================

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import {
  ARENA_ROWS,
  ARENA_COLS,
  CELL_EMPTY,
  CELL_SHEEP,
  CELL_HIT,
  CELL_MISS,
} from '../constants';

// ============================================================================
// TYPES
// ============================================================================

interface ThreeArenaProps {
  isPlayerArena: boolean;
  arenaData: Record<string, number>;     // "row-col" -> CELL_EMPTY | CELL_SHEEP
  shots: Record<string, number>;          // "row-col" -> CELL_HIT | CELL_MISS
  validCells: Set<string>;                // valid placement cells during setup
  gamePhase: string;                      // 'setup' | 'playing' | 'gameover'
  currentHerdCells: [number, number][];    // cells of current herd being placed
  onCellClick: (row: number, col: number, event?: MouseEvent) => void;
  overlayText?: string;
  overlaySubtext?: string;
  showOverlay?: boolean;
  opponentName?: string;
  title?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HEX_SIZE = 1.35;
const HEX_HEIGHT = 0.35;
const HEX_GAP = 0.1;

// Colors
const COLORS = {
  grass: [0x6cc040, 0x7cd04a, 0x5db535, 0x8de055, 0x6ec042],
  sheep: 0xd4e88a,
  hit: 0xc04030,
  miss: 0x6a6a45,
  hover: 0x80c858,
  valid: 0x70b840,
  disabled: 0x2a3a1a,
  herdPreview: 0xfbbf24,
  border: 0x5a9c35,
};

// ============================================================================
// HEX GEOMETRY BUILDER
// ============================================================================

function createHexGeometry(radius: number, height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    // Flat-top: offset by 30 degrees (Math.PI / 6)
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  return new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
  });
}

// ============================================================================
// 3D SHEEP — 10 Unique Variants with funky animations
// ============================================================================

// Animation types for each sheep
type SheepAnimType = 'backflip' | 'headbang' | 'spin' | 'bounce' | 'waddle' | 
                     'jiggle' | 'peek' | 'dance' | 'nod' | 'wiggle';

const SHEEP_ANIM_TYPES: SheepAnimType[] = [
  'backflip', 'headbang', 'spin', 'bounce', 'waddle',
  'jiggle', 'peek', 'dance', 'nod', 'wiggle'
];

interface SheepVariant {
  woolColor: number;
  headColor: number;
  earColor: number;
  noseColor: number;
  eyeColor: number;
  accessory: 'none' | 'crown' | 'mohawk' | 'bowtie' | 'sunglasses' | 'halo' | 'horns' | 'bandana' | 'tophat' | 'flower';
  scale: number;
  animType: SheepAnimType;
  name: string;
}

const SHEEP_VARIANTS: SheepVariant[] = [
  // Index 0 = Wanderer (always first sheep placed)
  { woolColor: 0x1a1a1a, headColor: 0x0a0a0a, earColor: 0x1a1a1a, noseColor: 0xff5566, eyeColor: 0xff0000, accessory: 'horns',       scale: 0.95, animType: 'headbang', name: 'Dark Sheep' },
  // Index 1-2 = Pair
  { woolColor: 0xf5f0e0, headColor: 0x2a2a2a, earColor: 0x3a3a3a, noseColor: 0xff8899, eyeColor: 0x111111, accessory: 'crown',      scale: 0.9, animType: 'backflip',  name: 'King Baa' },
  { woolColor: 0xffb6d9, headColor: 0x4a2a3a, earColor: 0x5a3a4a, noseColor: 0xff99bb, eyeColor: 0x111111, accessory: 'flower',      scale: 0.85, animType: 'dance',    name: 'Pinky' },
  // Index 3-5 = Trio
  { woolColor: 0xb8e0ff, headColor: 0x2a3a4a, earColor: 0x3a4a5a, noseColor: 0x88bbff, eyeColor: 0x111111, accessory: 'sunglasses',  scale: 0.9, animType: 'spin',     name: 'Cool Blue' },
  { woolColor: 0xffe0a0, headColor: 0x4a3a1a, earColor: 0x5a4a2a, noseColor: 0xffaa55, eyeColor: 0x111111, accessory: 'tophat',      scale: 0.92, animType: 'nod',      name: 'Sir Woolsworth' },
  { woolColor: 0xc8ffc8, headColor: 0x1a3a1a, earColor: 0x2a4a2a, noseColor: 0x66dd88, eyeColor: 0x111111, accessory: 'mohawk',      scale: 0.88, animType: 'bounce',   name: 'Punk Lamb' },
  // Index 6-9 = Quad
  { woolColor: 0xe8d0ff, headColor: 0x3a2a4a, earColor: 0x4a3a5a, noseColor: 0xcc88ff, eyeColor: 0x111111, accessory: 'halo',        scale: 0.87, animType: 'waddle',   name: 'Angel Fleece' },
  { woolColor: 0xffd4b8, headColor: 0x4a2a1a, earColor: 0x5a3a2a, noseColor: 0xff7744, eyeColor: 0x111111, accessory: 'bandana',     scale: 0.9, animType: 'jiggle',   name: 'Rusty' },
  { woolColor: 0xf0f0f0, headColor: 0x3a3a3a, earColor: 0x4a4a4a, noseColor: 0xff8888, eyeColor: 0x111111, accessory: 'bowtie',      scale: 0.86, animType: 'peek',     name: 'Fancy Pants' },
  { woolColor: 0xffff88, headColor: 0x3a3a0a, earColor: 0x4a4a1a, noseColor: 0xffcc00, eyeColor: 0x111111, accessory: 'none',        scale: 0.93, animType: 'wiggle',   name: 'Golden Fleece' },
];

function createSheepMarker(variantIndex: number): THREE.Group {
  const variant = SHEEP_VARIANTS[variantIndex % SHEEP_VARIANTS.length];

  const group = new THREE.Group();
  const woolMat = new THREE.MeshStandardMaterial({ color: variant.woolColor, roughness: 1.0, metalness: 0 });

  // Main body
  const bodyGeo = new THREE.SphereGeometry(0.5, 16, 12);
  const body = new THREE.Mesh(bodyGeo, woolMat);
  body.position.y = 0.5;
  body.scale.set(1.1, 0.85, 1.2);
  body.castShadow = true;
  group.add(body);

  // Wool bumps
  const bumpGeo = new THREE.SphereGeometry(0.22, 10, 8);
  [[0, 0.85, 0], [-0.25, 0.78, 0.1], [0.25, 0.78, -0.1], [0, 0.75, 0.3],
   [0, 0.75, -0.3], [-0.4, 0.55, 0], [0.4, 0.55, 0]].forEach(([x, y, z]) => {
    const bump = new THREE.Mesh(bumpGeo, woolMat);
    bump.position.set(x!, y!, z!);
    bump.scale.set(0.8 + Math.random() * 0.4, 0.7 + Math.random() * 0.3, 0.8 + Math.random() * 0.4);
    group.add(bump);
  });

  // Head
  const headGeo = new THREE.SphereGeometry(0.25, 12, 10);
  const headMat = new THREE.MeshStandardMaterial({ color: variant.headColor, roughness: 0.6 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 0.6, 0.5);
  head.scale.set(1, 0.9, 0.85);
  group.add(head);

  // Googly eyes
  const eyeWhiteGeo = new THREE.SphereGeometry(0.1, 10, 10);
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const pupilMat = new THREE.MeshBasicMaterial({ color: variant.eyeColor });

  [[-0.1, 0.7, 0.7], [0.1, 0.7, 0.7]].forEach(([x, y, z]) => {
    const white = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
    white.position.set(x!, y!, z!);
    group.add(white);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(x!, y!, z! + 0.07);
    group.add(pupil);
  });

  // Nose
  const noseGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const noseMat = new THREE.MeshStandardMaterial({ color: variant.noseColor, roughness: 0.5 });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0, 0.55, 0.72);
  nose.scale.set(1.2, 0.8, 0.8);
  group.add(nose);

  // Ears
  const earGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const earMat = new THREE.MeshStandardMaterial({ color: variant.earColor, roughness: 0.7 });
  const leftEar = new THREE.Mesh(earGeo, earMat);
  leftEar.position.set(-0.22, 0.62, 0.42);
  leftEar.scale.set(0.6, 1.3, 0.5);
  leftEar.rotation.set(-0.3, 0, 0.5);
  group.add(leftEar);
  const rightEar = leftEar.clone();
  rightEar.position.set(0.22, 0.62, 0.42);
  rightEar.rotation.set(-0.3, 0, -0.5);
  group.add(rightEar);

  // Legs with hooves
  const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.22, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  [[-0.2, 0.11, -0.18], [0.2, 0.11, -0.18], [-0.2, 0.11, 0.22], [0.2, 0.11, 0.22]].forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x!, y!, z!);
    group.add(leg);
  });

  // Tail
  const tailGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const tail = new THREE.Mesh(tailGeo, woolMat);
  tail.position.set(0, 0.5, -0.55);
  group.add(tail);

  // ===== ACCESSORIES =====
  addAccessory(group, variant);

  group.scale.setScalar(variant.scale);
  group.userData.animType = variant.animType;
  group.userData.variantName = variant.name;
  return group;
}

function addAccessory(group: THREE.Group, variant: SheepVariant) {
  switch (variant.accessory) {
    case 'crown': {
      const crownMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.08, 6), crownMat);
      base.position.set(0, 0.98, 0.05);
      group.add(base);
      // Crown points
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), crownMat);
        point.position.set(Math.cos(angle) * 0.15, 1.07, Math.sin(angle) * 0.15 + 0.05);
        group.add(point);
      }
      // Gem
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff0044 }));
      gem.position.set(0, 1.05, 0.2);
      group.add(gem);
      break;
    }
    case 'mohawk': {
      const mohawkMat = new THREE.MeshStandardMaterial({ color: 0xff2266, roughness: 0.8 });
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18 + Math.random() * 0.08, 5), mohawkMat);
        spike.position.set(0, 0.95 + i * 0.01, -0.15 + i * 0.08);
        spike.rotation.x = -0.3;
        group.add(spike);
      }
      break;
    }
    case 'sunglasses': {
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5 });
      const lensMat = new THREE.MeshStandardMaterial({ color: 0x1a1a3a, metalness: 0.9, roughness: 0.1 });
      // Lenses
      const lensGeo = new THREE.SphereGeometry(0.1, 8, 8);
      const leftLens = new THREE.Mesh(lensGeo, lensMat);
      leftLens.position.set(-0.1, 0.68, 0.78);
      leftLens.scale.set(1, 0.8, 0.3);
      group.add(leftLens);
      const rightLens = leftLens.clone();
      rightLens.position.set(0.1, 0.68, 0.78);
      group.add(rightLens);
      // Bridge
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 4), frameMat);
      bridge.position.set(0, 0.68, 0.78);
      bridge.rotation.z = Math.PI / 2;
      group.add(bridge);
      break;
    }
    case 'tophat': {
      const hatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16), hatMat);
      brim.position.set(0, 0.95, 0.05);
      group.add(brim);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.25, 16), hatMat);
      top.position.set(0, 1.1, 0.05);
      group.add(top);
      // Band
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.171, 0.171, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0xcc2244 }));
      band.position.set(0, 1.0, 0.05);
      group.add(band);
      break;
    }
    case 'halo': {
      const haloMat = new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0.7 });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), haloMat);
      halo.position.set(0, 1.1, 0.05);
      halo.rotation.x = -Math.PI / 6;
      group.add(halo);
      break;
    }
    case 'horns': {
      const hornMat = new THREE.MeshStandardMaterial({ color: 0x8b0000, roughness: 0.3, metalness: 0.4 });
      const hornGeo = new THREE.ConeGeometry(0.06, 0.25, 6);
      const leftHorn = new THREE.Mesh(hornGeo, hornMat);
      leftHorn.position.set(-0.2, 0.95, 0.15);
      leftHorn.rotation.z = 0.4;
      leftHorn.rotation.x = -0.2;
      group.add(leftHorn);
      const rightHorn = new THREE.Mesh(hornGeo, hornMat);
      rightHorn.position.set(0.2, 0.95, 0.15);
      rightHorn.rotation.z = -0.4;
      rightHorn.rotation.x = -0.2;
      group.add(rightHorn);
      break;
    }
    case 'bowtie': {
      const bowMat = new THREE.MeshStandardMaterial({ color: 0xcc1144 });
      const left = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), bowMat);
      left.position.set(-0.05, 0.4, 0.5);
      left.rotation.z = Math.PI / 2;
      group.add(left);
      const right = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), bowMat);
      right.position.set(0.05, 0.4, 0.5);
      right.rotation.z = -Math.PI / 2;
      group.add(right);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), bowMat);
      knot.position.set(0, 0.4, 0.52);
      group.add(knot);
      break;
    }
    case 'bandana': {
      const bandanaMat = new THREE.MeshStandardMaterial({ color: 0xff4400 });
      const bandana = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.26, 0.06, 12), bandanaMat);
      bandana.position.set(0, 0.75, 0.45);
      bandana.rotation.x = 0.3;
      group.add(bandana);
      // Knot tail
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.15, 4), bandanaMat);
      tail.position.set(0.2, 0.7, 0.3);
      tail.rotation.z = -0.8;
      group.add(tail);
      break;
    }
    case 'flower': {
      const petalMat = new THREE.MeshStandardMaterial({ color: 0xff66aa });
      const centerMat = new THREE.MeshStandardMaterial({ color: 0xffdd00 });
      const center = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), centerMat);
      center.position.set(-0.25, 0.85, 0.3);
      group.add(center);
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), petalMat);
        petal.position.set(-0.25 + Math.cos(angle) * 0.06, 0.85, 0.3 + Math.sin(angle) * 0.06);
        petal.scale.set(1.2, 0.6, 1.2);
        group.add(petal);
      }
      break;
    }
    case 'none':
    default:
      break;
  }
}

// Animate a sheep based on its variant's animation type
function animateSheepVariant(group: THREE.Group, t: number, baseY: number) {
  const phase = group.userData.phase || 0;
  const animType: SheepAnimType = group.userData.animType || 'bounce';
  const speed = t * 2 + phase;

  switch (animType) {
    case 'backflip': {
      // Periodic backflip every ~4 seconds
      const cycle = (t + phase) % 4;
      if (cycle < 0.8) {
        const flipProgress = cycle / 0.8;
        group.position.y = baseY + Math.sin(flipProgress * Math.PI) * 0.8;
        group.rotation.x = flipProgress * Math.PI * 2;
      } else {
        group.position.y = baseY + Math.sin(speed) * 0.06;
        group.rotation.x = 0;
      }
      group.rotation.y = Math.sin(t * 0.5 + phase) * 0.1;
      break;
    }
    case 'headbang': {
      group.position.y = baseY + Math.sin(speed) * 0.04;
      // Aggressive head bob
      group.rotation.x = Math.sin(t * 6 + phase) * 0.35;
      group.rotation.y = Math.sin(t * 0.3 + phase) * 0.15;
      break;
    }
    case 'spin': {
      group.position.y = baseY + Math.sin(speed) * 0.05;
      // Continuous slow spin with occasional fast spin
      const spinCycle = (t + phase) % 6;
      if (spinCycle < 1.5) {
        group.rotation.y = (spinCycle / 1.5) * Math.PI * 4;
      } else {
        group.rotation.y = Math.sin(t * 0.4 + phase) * 0.2;
      }
      break;
    }
    case 'bounce': {
      // Exaggerated bouncing with squash/stretch
      const bounceT = Math.abs(Math.sin(t * 3 + phase));
      group.position.y = baseY + bounceT * 0.4;
      const squash = 1 + (1 - bounceT) * 0.15;
      const stretch = 1 - (1 - bounceT) * 0.1;
      group.scale.set(squash * 0.9, stretch * 0.9, squash * 0.9);
      group.rotation.y = Math.sin(t * 0.5 + phase) * 0.1;
      break;
    }
    case 'waddle': {
      group.position.y = baseY + Math.abs(Math.sin(t * 2.5 + phase)) * 0.08;
      // Side-to-side rocking
      group.rotation.z = Math.sin(t * 3 + phase) * 0.25;
      group.rotation.y = Math.sin(t * 0.6 + phase) * 0.15;
      // Slight forward-back sway
      group.position.x = group.userData.baseX + Math.sin(t * 1.5 + phase) * 0.08;
      break;
    }
    case 'jiggle': {
      group.position.y = baseY + Math.sin(speed) * 0.05;
      // Rapid vibration/jiggle
      group.rotation.x = Math.sin(t * 10 + phase) * 0.08;
      group.rotation.z = Math.cos(t * 12 + phase) * 0.08;
      group.rotation.y = Math.sin(t * 8 + phase) * 0.06;
      break;
    }
    case 'peek': {
      // Peek up and duck down
      const peekCycle = (t * 0.8 + phase) % Math.PI;
      const peekAmount = Math.max(0, Math.sin(peekCycle * 2));
      group.position.y = baseY - 0.15 + peekAmount * 0.35;
      group.rotation.x = (1 - peekAmount) * 0.3;
      group.rotation.y = Math.sin(t * 0.4 + phase) * 0.2;
      break;
    }
    case 'dance': {
      // Disco dance — bob + twist + arm waves
      const beat = Math.sin(t * 4 + phase);
      group.position.y = baseY + Math.abs(beat) * 0.15;
      group.rotation.y = Math.sin(t * 2 + phase) * 0.4;
      group.rotation.z = beat * 0.15;
      group.rotation.x = Math.sin(t * 2 + phase + 1) * 0.1;
      break;
    }
    case 'nod': {
      group.position.y = baseY + Math.sin(speed * 0.5) * 0.04;
      // Dignified nodding
      group.rotation.x = Math.sin(t * 1.5 + phase) * 0.2;
      group.rotation.y = Math.sin(t * 0.3 + phase) * 0.05;
      break;
    }
    case 'wiggle': {
      group.position.y = baseY + Math.sin(speed) * 0.05;
      // Butt wiggle — rotate around Y rapidly with Z wobble
      group.rotation.y = Math.sin(t * 5 + phase) * 0.3;
      group.rotation.z = Math.sin(t * 5 + phase + Math.PI / 2) * 0.1;
      break;
    }
  }
}

// ============================================================================
// HIT MARKER — Lamb chop on the grill!
// ============================================================================

function createHitMarker(): THREE.Group {
  const group = new THREE.Group();

  // === LAMB CHOP ===
  const chopGroup = new THREE.Group();

  // Meat (main chop - rounded trapezoid shape using scaled sphere)
  const meatGeo = new THREE.SphereGeometry(0.3, 12, 10);
  const meatMat = new THREE.MeshStandardMaterial({
    color: 0xcc7744,
    roughness: 0.6,
    metalness: 0.1,
  });
  const meat = new THREE.Mesh(meatGeo, meatMat);
  meat.position.set(0, 0.35, 0);
  meat.scale.set(1.2, 0.5, 0.9);
  meat.castShadow = true;
  chopGroup.add(meat);

  // Cooked crust (darker top layer)
  const crustGeo = new THREE.SphereGeometry(0.28, 12, 10);
  const crustMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.8,
    metalness: 0.05,
  });
  const crust = new THREE.Mesh(crustGeo, crustMat);
  crust.position.set(0, 0.42, 0);
  crust.scale.set(1.1, 0.3, 0.85);
  chopGroup.add(crust);

  // Grill marks (dark stripes across the top)
  const grillMat = new THREE.MeshStandardMaterial({ color: 0x3a1a0a, roughness: 0.9 });
  for (let i = -1; i <= 1; i++) {
    const grillMark = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4),
      grillMat
    );
    grillMark.position.set(i * 0.12, 0.45, 0);
    grillMark.rotation.z = Math.PI / 2;
    grillMark.rotation.y = 0.3;
    chopGroup.add(grillMark);
  }

  // Bone (sticking out from the chop)
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xf5f0e0,
    roughness: 0.4,
    metalness: 0.1,
  });
  // Bone shaft
  const boneShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.035, 0.5, 8),
    boneMat
  );
  boneShaft.position.set(0, 0.55, -0.3);
  boneShaft.rotation.x = 0.6;
  chopGroup.add(boneShaft);
  // Bone knob (rounded end)
  const boneKnob = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    boneMat
  );
  boneKnob.position.set(0, 0.78, -0.52);
  chopGroup.add(boneKnob);

  // Fat marbling (lighter patches)
  const fatMat = new THREE.MeshStandardMaterial({
    color: 0xeedd99,
    roughness: 0.5,
    metalness: 0.05,
  });
  const fatPositions = [
    [-0.15, 0.36, 0.1], [0.1, 0.38, -0.05], [0.2, 0.34, 0.08],
    [-0.08, 0.33, -0.12], [0.15, 0.36, 0.15],
  ];
  fatPositions.forEach(([x, y, z]) => {
    const fat = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), fatMat);
    fat.position.set(x!, y!, z!);
    fat.scale.set(1.2, 0.4, 1);
    chopGroup.add(fat);
  });

  // Garnish — tiny sprig of rosemary
  const herbMat = new THREE.MeshStandardMaterial({ color: 0x2d5a1e });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 4), herbMat);
  stem.position.set(0.2, 0.48, 0.15);
  stem.rotation.z = -0.5;
  chopGroup.add(stem);
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), herbMat);
    leaf.position.set(0.2 + (i - 1.5) * 0.04, 0.5 + i * 0.02, 0.15);
    leaf.scale.set(0.6, 0.3, 1);
    chopGroup.add(leaf);
  }

  group.add(chopGroup);

  // === STEAM PUFFS ===
  const steamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  for (let i = 0; i < 3; i++) {
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.08 + i * 0.03, 6, 6), steamMat.clone());
    steam.position.set(
      (Math.random() - 0.5) * 0.2,
      0.6 + i * 0.15,
      (Math.random() - 0.5) * 0.2
    );
    steam.userData.steamIndex = i;
    steam.userData.isSteam = true;
    group.add(steam);
  }

  // Slight random rotation so each chop looks different
  chopGroup.rotation.y = Math.random() * Math.PI * 2;

  group.scale.set(0.85, 0.85, 0.85);
  return group;
}

// ============================================================================
// MISS MARKER (splash ring)
// ============================================================================

function createMissMarker(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.TorusGeometry(0.2, 0.05, 8, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8888aa,
    transparent: true,
    opacity: 0.5,
    roughness: 0.8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.38;
  mesh.rotation.x = -Math.PI / 2;
  group.add(mesh);
  return group;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function ThreeArena({
  isPlayerArena,
  arenaData,
  shots,
  validCells,
  gamePhase,
  currentHerdCells,
  onCellClick,
  overlayText = '',
  overlaySubtext = '',
  showOverlay = false,
  opponentName = 'Opponent',
  title = '',
}: ThreeArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cellMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const markerGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const hoveredRef = useRef<string | null>(null);
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2(-10, -10));
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  // Camera orbit state
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const sphericalRef = useRef({ theta: 0, phi: Math.PI / 4, radius: 32 });
  const targetSphericalRef = useRef({ theta: 0, phi: Math.PI / 4, radius: 32 });

  // ============================================================================
  // INIT SCENE
  // ============================================================================

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0e1a, 0.02);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.0;
    renderer.setClearColor(0x000000, 0); // fully transparent — container bg shows behind
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0x99aabb, 1.8);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    dirLight.position.set(6, 12, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 15;
    dirLight.shadow.camera.bottom = -15;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x6699ff, 0.6);
    rimLight.position.set(-4, 6, -8);
    scene.add(rimLight);

    const underGlow = new THREE.PointLight(0x44cc66, 0.6, 25);
    underGlow.position.set(0, -1.5, 0);
    scene.add(underGlow);

    // Build hex grid
    const gridGroup = new THREE.Group();
    gridGroupRef.current = gridGroup;

    const hexGeo = createHexGeometry(HEX_SIZE - HEX_GAP, HEX_HEIGHT);

    for (const row of ARENA_ROWS) {
      const cols = ARENA_COLS[row];
      for (const col of cols) {
        const colorIndex = Math.abs((row * 7 + col * 13 + row * col * 3) % COLORS.grass.length);
        const mat = new THREE.MeshStandardMaterial({
          color: COLORS.grass[colorIndex],
          roughness: 0.6,
          metalness: 0.05,
          flatShading: true,
        });

        const mesh = new THREE.Mesh(hexGeo, mat);

        // Position: flat-top hex honeycomb layout
        // Each row is centered independently (like CSS flexbox centering)
        // No odd-row shift — the diamond shape comes from varying row widths
        // Flat-top: cell width = sqrt(3) * size, height = 2 * size
        // Wall-to-wall spacing within row = sqrt(3) * size
        // Row spacing for interlocking = 1.5 * size
        const colsInRow = cols.length;
        const centerOffset = (colsInRow - 1) / 2;
        const colIdx = cols.indexOf(col);
        const xSpacing = HEX_SIZE * Math.sqrt(3);
        const zSpacing = HEX_SIZE * 1.5;
        const xOff = (colIdx - centerOffset) * xSpacing;
        const zOff = (row - 3) * zSpacing;

        mesh.position.set(xOff, 0, zOff);
        mesh.rotation.x = -Math.PI / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const key = `${row}-${col}`;
        mesh.userData = {
          row, col, key,
          baseColor: COLORS.grass[colorIndex],
          targetY: 0,
        };

        gridGroup.add(mesh);
        cellMeshesRef.current.set(key, mesh);
      }
    }

    scene.add(gridGroup);

    // Floating particles
    const particleCount = 60;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 18;
      pPos[i * 3 + 1] = Math.random() * 6;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x88ccaa,
      size: 0.04,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(pGeo, pMat);
    particles.userData.speeds = Array.from({ length: particleCount }, () => 0.002 + Math.random() * 0.006);
    scene.add(particles);

    // Animation loop
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const t = clockRef.current.getElapsedTime();

      // Smooth orbit camera
      const s = sphericalRef.current;
      const ts = targetSphericalRef.current;
      s.theta += (ts.theta - s.theta) * 0.08;
      s.phi += (ts.phi - s.phi) * 0.08;
      s.radius += (ts.radius - s.radius) * 0.08;

      camera.position.x = s.radius * Math.sin(s.phi) * Math.sin(s.theta);
      camera.position.y = s.radius * Math.cos(s.phi);
      camera.position.z = s.radius * Math.sin(s.phi) * Math.cos(s.theta);
      camera.lookAt(0, 0, 0);

      // Hover detection
      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const meshes = Array.from(cellMeshesRef.current.values());
      const intersects = raycasterRef.current.intersectObjects(meshes);

      const newHovered = intersects.length > 0 ? intersects[0].object.userData.key : null;
      if (newHovered !== hoveredRef.current) {
        // Reset previous
        if (hoveredRef.current) {
          const prev = cellMeshesRef.current.get(hoveredRef.current);
          if (prev) prev.userData.targetY = 0;
        }
        // Set new
        if (newHovered) {
          const next = cellMeshesRef.current.get(newHovered);
          if (next) next.userData.targetY = 0.08;
        }
        hoveredRef.current = newHovered;
      }

      // Animate cell heights
      cellMeshesRef.current.forEach((mesh) => {
        const target = mesh.userData.targetY || 0;
        mesh.position.y += (target - mesh.position.y) * 0.12;
      });

      // Animate sheep markers (variant-specific animations)
      markerGroupsRef.current.forEach((group) => {
        if (group.userData.type === 'sheep') {
          const cell = cellMeshesRef.current.get(group.userData.cellKey);
          if (cell) {
            const baseY = cell.position.y + HEX_HEIGHT + 0.05;
            group.position.x = cell.position.x;
            group.position.z = cell.position.z;
            animateSheepVariant(group, t, baseY);
          }
        }
        // Animate lamb chop steam rising
        if (group.userData.type === 'hit') {
          group.traverse((child) => {
            if ((child as THREE.Mesh).userData?.isSteam) {
              const idx = child.userData.steamIndex;
              const baseOffset = 0.6 + idx * 0.15;
              child.position.y = baseOffset + Math.sin(t * 1.5 + idx * 2) * 0.12 + ((t * 0.3 + idx) % 1) * 0.2;
              const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
              mat.opacity = 0.15 + Math.sin(t * 2 + idx * 1.5) * 0.1;
              child.scale.setScalar(1 + Math.sin(t + idx) * 0.2);
            }
          });
        }
      });

      // Particles
      const positions = particles.geometry.attributes.position.array as Float32Array;
      const speeds = particles.userData.speeds;
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3 + 1] += speeds[i];
        if (positions[i * 3 + 1] > 7) {
          positions[i * 3 + 1] = 0;
          positions[i * 3] = (Math.random() - 0.5) * 18;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
        }
      }
      particles.geometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      cellMeshesRef.current.clear();
      markerGroupsRef.current.clear();
    };
  }, [isPlayerArena]);

  // ============================================================================
  // UPDATE CELL VISUALS (runs on arenaData/shots/validCells changes)
  // ============================================================================

  useEffect(() => {
    const gridGroup = gridGroupRef.current;
    if (!gridGroup) return;

    const prevMarkers = markerGroupsRef.current;

    // Remove old markers
    prevMarkers.forEach((marker, key) => {
      gridGroup.remove(marker);
    });
    prevMarkers.clear();

    // Build stable cell→variant mapping: collect sheep cells, sort by key, assign indices
    const sheepCellKeys: string[] = [];
    cellMeshesRef.current.forEach((mesh, key) => {
      const cell = arenaData[key] ?? CELL_EMPTY;
      const shot = shots[key];
      if (!shot && isPlayerArena && cell === CELL_SHEEP) {
        sheepCellKeys.push(key);
      }
    });
    sheepCellKeys.sort(); // stable order by "row-col"
    const sheepVariantMap = new Map<string, number>();
    sheepCellKeys.forEach((key, i) => sheepVariantMap.set(key, i));

    // Stable phase map — reuse previous phases so animations don't reset
    if (!gridGroup.userData.phaseMap) gridGroup.userData.phaseMap = new Map<string, number>();
    const phaseMap = gridGroup.userData.phaseMap as Map<string, number>;

    // Update each cell
    cellMeshesRef.current.forEach((mesh, key) => {
      const cell = arenaData[key] ?? CELL_EMPTY;
      const shot = shots[key];
      const isValid = isPlayerArena && gamePhase === 'setup' && validCells.has(key) && cell !== CELL_SHEEP;
      const isDisabled = isPlayerArena && gamePhase === 'setup' && !validCells.has(key) && cell !== CELL_SHEEP;
      const isHerdPreview = currentHerdCells.some(([r, c]) => `${r}-${c}` === key);

      const mat = mesh.material as THREE.MeshStandardMaterial;

      if (shot === CELL_HIT) {
        mat.color.setHex(COLORS.hit);
        mat.emissive.setHex(0x220000);
        mesh.userData.targetY = -0.05;

        const marker = createHitMarker();
        marker.position.copy(mesh.position);
        marker.position.y = mesh.position.y;
        marker.userData = { type: 'hit', cellKey: key };
        gridGroup.add(marker);
        prevMarkers.set(key, marker);

      } else if (shot === CELL_MISS) {
        mat.color.setHex(COLORS.miss);
        mat.emissive.setHex(0x000000);
        mesh.userData.targetY = -0.02;

        const marker = createMissMarker();
        marker.position.copy(mesh.position);
        marker.position.y = mesh.position.y;
        marker.userData = { type: 'miss', cellKey: key };
        gridGroup.add(marker);
        prevMarkers.set(key, marker);

      } else if (isPlayerArena && cell === CELL_SHEEP) {
        mat.color.setHex(COLORS.sheep);
        mat.emissive.setHex(0x111100);
        mesh.userData.targetY = 0.1;

        const variantIdx = sheepVariantMap.get(key) ?? 0;
        // Reuse phase if this cell had a sheep before, else create one
        if (!phaseMap.has(key)) phaseMap.set(key, Math.random() * Math.PI * 2);
        const phase = phaseMap.get(key)!;

        const sheep = createSheepMarker(variantIdx);
        sheep.position.copy(mesh.position);
        sheep.position.y = HEX_HEIGHT + 0.1;
        sheep.userData = {
          ...sheep.userData,
          type: 'sheep',
          cellKey: key,
          phase,
          baseX: mesh.position.x,
        };
        gridGroup.add(sheep);
        prevMarkers.set(key, sheep);

      } else if (isHerdPreview) {
        mat.color.setHex(COLORS.herdPreview);
        mat.emissive.setHex(0x221100);
        mesh.userData.targetY = 0.06;

      } else if (isValid) {
        mat.color.setHex(COLORS.valid);
        mat.emissive.setHex(0x001100);
        mesh.userData.targetY = 0.03;

      } else if (isDisabled) {
        mat.color.setHex(COLORS.disabled);
        mat.emissive.setHex(0x000000);
        mesh.userData.targetY = -0.03;

      } else {
        mat.color.setHex(mesh.userData.baseColor);
        mat.emissive.setHex(0x000000);
        mesh.userData.targetY = 0;
      }
    });
  }, [arenaData, shots, validCells, gamePhase, currentHerdCells, isPlayerArena]);

  // ============================================================================
  // OVERLAY DIMMING EFFECT
  // ============================================================================

  useEffect(() => {
    cellMeshesRef.current.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (showOverlay) {
        mat.opacity = 0.4;
        mat.transparent = true;
      } else {
        mat.opacity = 1;
        mat.transparent = false;
      }
    });
  }, [showOverlay]);

  // ============================================================================
  // MOUSE HANDLERS
  // ============================================================================

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (isDraggingRef.current) {
      const dx = e.clientX - prevMouseRef.current.x;
      const dy = e.clientY - prevMouseRef.current.y;
      targetSphericalRef.current.theta -= dx * 0.005;
      targetSphericalRef.current.phi = Math.max(
        0.2,
        Math.min(Math.PI / 2.2, targetSphericalRef.current.phi + dy * 0.005)
      );
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      // Right-click = orbit
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (showOverlay) return;
    if (!cameraRef.current) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);
    const meshes = Array.from(cellMeshesRef.current.values());
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const { row, col } = intersects[0].object.userData;
      onCellClick(row, col, e.nativeEvent);
    }
  }, [onCellClick, showOverlay]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    targetSphericalRef.current.radius = Math.max(
      16,
      Math.min(35, targetSphericalRef.current.radius + e.deltaY * 0.015)
    );
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Touch handlers
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const lastTouchDistRef = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      isDraggingRef.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      targetSphericalRef.current.radius = Math.max(
        16,
        Math.min(35, targetSphericalRef.current.radius - (dist - lastTouchDistRef.current) * 0.03)
      );
      lastTouchDistRef.current = dist;

      // Two-finger orbit
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const ddx = midX - lastTouchRef.current.x;
      const ddy = midY - lastTouchRef.current.y;
      targetSphericalRef.current.theta -= ddx * 0.004;
      targetSphericalRef.current.phi = Math.max(
        0.2,
        Math.min(Math.PI / 2.2, targetSphericalRef.current.phi + ddy * 0.004)
      );
      lastTouchRef.current = { x: midX, y: midY };
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // ============================================================================
  // CAMERA VIEW PRESETS
  // ============================================================================

  const resetCameraView = useCallback(() => {
    targetSphericalRef.current = { theta: 0, phi: Math.PI / 4, radius: 32 };
  }, []);

  const topDownView = useCallback(() => {
    targetSphericalRef.current = { theta: 0, phi: 0.05, radius: 24 };
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================

  const arenaLabel = title || (isPlayerArena ? 'Your Herd' : `${opponentName}'s Herd`);

  return (
    <div
      className={`arena-3d ${isPlayerArena ? 'player-arena-3d' : 'opponent-arena-3d'}`}
      style={{ position: 'relative' }}
    >
      {/* Title bar */}
      <div className={`arena-3d-title ${isPlayerArena ? 'player-title' : 'opponent-title'}`}>
        {arenaLabel}
      </div>

      {/* Camera view buttons — overlaid on canvas */}
      <div
        style={{
          position: 'absolute',
          top: '2.2rem',
          right: '0.5rem',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
        }}
      >
        <button
          className="arena-view-btn"
          onClick={(e) => { e.stopPropagation(); resetCameraView(); }}
          title="Reset view"
        >
          ↺
        </button>
        <button
          className="arena-view-btn"
          onClick={(e) => { e.stopPropagation(); topDownView(); }}
          title="Top-down view"
        >
          ⬇
        </button>
      </div>

      {/* Three.js canvas container */}
      <div
        ref={containerRef}
        className={`arena-3d-canvas ${showOverlay ? 'overlay-active' : ''}`}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Status overlay */}
      {showOverlay && (
        <div className="arena-3d-overlay">
          <div className="arena-3d-overlay-card">
            <div className="arena-overlay-text">
              {overlayText}
            </div>
            {overlaySubtext && (
              <div className="arena-overlay-subtext">
                {overlaySubtext}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}