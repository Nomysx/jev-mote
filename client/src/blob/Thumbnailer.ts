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
    const r = this.ensure();
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
