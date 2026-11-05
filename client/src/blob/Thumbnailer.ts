// Renders small still images of the blob for journal entries and the weekly mood strip,
// using the same shader as the live blob (one shared offscreen WebGL context).

import * as THREE from 'three';
import type { VisualParams } from '../../../shared/visuals';
import { applyVisual, createBlobGeometry, createBlobMaterial } from './material';

export class Thumbnailer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  private material = createBlobMaterial();
  private mesh = new THREE.Mesh(createBlobGeometry(96, 72), this.material);
  private cache = new Map<string, string>();

  constructor(private size = 144) {
    this.scene.add(this.mesh);
    this.camera.position.set(0, 0.1, 5.6);
    this.camera.lookAt(0, -0.05, 0);
  }

  private ensure(): THREE.WebGLRenderer {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(this.size, this.size, false);
      this.renderer.setClearColor(0x000000, 0);
    }
    return this.renderer;
  }

  /** A data URL of the blob with these params. `phase` freezes its movement at a point in time. */
  render(key: string, v: VisualParams, seed: number, phase = 0): string {
    const hit = this.cache.get(key);
    if (hit) return hit;
    let r: THREE.WebGLRenderer;
    try {
      r = this.ensure();
    } catch {
      const flat = flatThumbnail(v, this.size);
      this.cache.set(key, flat);
      return flat;
    }
    const u = this.material.uniforms;
    applyVisual(u, v);
    u.uSeed.value = (seed % 997) / 97;
    u.uPhase.value = phase;
    u.uTime.value = phase;
    u.uListen.value = 0;
    u.uPulse.value = 0;
    u.uOpacity.value = 1;
    u.uCursorDir.value.set(0, 0, 1);
    this.mesh.scale.setScalar(v.scale);
    this.mesh.position.set(0, -v.sink * 0.55, 0);
    this.camera.position.z = 5.2 - 0.9 * v.closeness;
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.cache.set(key, url);
    return url;
  }
}

/** A soft 2D blob in the same colors, when WebGL isn't available. */
function flatThumbnail(v: VisualParams, size: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  const r = size * 0.32 * v.scale;
  const x = size / 2;
  const y = size / 2 + v.sink * size * 0.1;
  const hue = Math.round(v.hueA * 360);
  const sat = Math.round(v.saturation * 75 * (1 - v.grey));
  const light = Math.max(20, Math.min(75, 34 + 22 * v.brightness));
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  grad.addColorStop(0, `hsl(${hue} ${sat}% ${Math.min(92, light + 22)}%)`);
  grad.addColorStop(1, `hsl(${hue} ${sat}% ${Math.max(10, light - 10)}%)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL('image/png');
}
