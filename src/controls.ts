// Caméra libre : position en double précision (Vector3 JS), orientation quaternion, vitesse logarithmique.
import * as THREE from 'three';

export class FlyControls {
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  speed = 2; // pc/s
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;

  private tmp = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, 'ZYX');

  constructor(el: HTMLElement) {

    window.addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('click', () => { if (document.pointerLockElement !== el) el.requestPointerLock(); });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch -= e.movementY * 0.0025;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      this.updateQuat();
    });
    window.addEventListener('wheel', (e) => {
      this.speed *= Math.exp(-e.deltaY * 0.002);
      this.speed = Math.max(1e-3, Math.min(2e5, this.speed));
    }, { passive: true });
    this.updateQuat();
  }

  lookAt(target: THREE.Vector3): void {
    const dir = this.tmp.copy(target).sub(this.position).normalize();
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.z)));
    this.yaw = Math.atan2(-dir.x, dir.y);
    this.updateQuat();
  }

  private updateQuat(): void {
    // repère : Z galactique = haut ; regard initial vers +Y
    this.euler.set(this.pitch + Math.PI / 2, 0, this.yaw, 'ZYX');
    this.quaternion.setFromEuler(this.euler);
  }

  update(dt: number): boolean {
    const k = this.keys;
    let fx = 0, fy = 0, fz = 0;
    if (k.has('KeyW') || k.has('KeyZ') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('KeyQ') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (k.has('Space')) fy += 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) fy -= 1;
    if (fx === 0 && fy === 0 && fz === 0) return false;
    const boost = k.has('AltLeft') ? 5 : 1;
    this.tmp.set(fx, fy, fz).normalize().multiplyScalar(this.speed * dt * boost).applyQuaternion(this.quaternion);
    this.position.add(this.tmp);
    return true;
  }
}
