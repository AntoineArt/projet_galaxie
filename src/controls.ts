// Caméra libre : position en double précision (Vector3 JS), orientation quaternion, vitesse logarithmique.
// Souris : glisser = regarder, clic simple = sélection (callback), L = verrouillage du pointeur.
// Mode orbite : la caméra tourne autour d'une cible (glisser) et s'en rapproche (molette).
import * as THREE from 'three';

export class FlyControls {
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  speed = 2; // pc/s
  /** mode orbite : cible (monde) fournie chaque frame, distance (pc) */
  orbit: { target: () => THREE.Vector3; dist: number; minDist: number } | null = null;
  onClick: ((x: number, y: number) => void) | null = null;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private drag: { x: number; y: number; moved: boolean; t: number } | null = null;
  private el: HTMLElement;

  private tmp = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, 'ZYX');

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      this.keys.add(e.code);
      if (e.code === 'KeyL' && !e.repeat) {
        if (document.pointerLockElement === el) document.exitPointerLock(); else el.requestPointerLock();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || document.pointerLockElement === el) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: false, t: performance.now() };
    });
    window.addEventListener('mousemove', (e) => {
      const locked = document.pointerLockElement === el;
      if (!locked && !this.drag) return;
      if (this.drag && !locked) {
        if (!this.drag.moved && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) < 4) return;
        this.drag.moved = true;
      }
      const k = locked ? 0.0025 : 0.004;
      this.look(-e.movementX * k, -e.movementY * k);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.drag) return;
      const d = this.drag; this.drag = null;
      if (!d.moved && performance.now() - d.t < 400) this.onClick?.(e.clientX, e.clientY);
    });
    window.addEventListener('wheel', (e) => {
      if (this.orbit) {
        this.orbit.dist = Math.max(this.orbit.minDist, this.orbit.dist * Math.exp(e.deltaY * 0.002));
        return;
      }
      this.speed *= Math.exp(-e.deltaY * 0.002);
      this.speed = Math.max(1e-8, Math.min(2e5, this.speed));
    }, { passive: true });
    this.updateQuat();
  }

  get pointerLocked(): boolean { return document.pointerLockElement === this.el; }

  private look(dyaw: number, dpitch: number): void {
    // en orbite, glisser fait tourner la caméra autour de la cible (sens inversé : on déplace la caméra)
    const s = this.orbit ? -1 : 1;
    this.yaw += dyaw * s;
    this.pitch += dpitch * s;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    this.updateQuat();
  }

  lookAt(target: THREE.Vector3): void {
    const dir = this.tmp.copy(target).sub(this.position).normalize();
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.z)));
    this.yaw = Math.atan2(-dir.x, dir.y);
    this.updateQuat();
  }

  /** direction de visée (monde) */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  /** entre en orbite autour d'une cible ; la caméra garde sa direction actuelle vers la cible */
  startOrbit(target: () => THREE.Vector3, dist: number, minDist: number): void {
    this.orbit = { target, dist, minDist };
    this.lookAt(target());
  }
  stopOrbit(): void { this.orbit = null; }

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
    const moving = fx !== 0 || fy !== 0 || fz !== 0;
    if (this.orbit) {
      if (moving) { this.orbit = null; }
      else {
        // position = cible - direction * distance
        const t = this.orbit.target();
        this.forward(this.tmp).multiplyScalar(-this.orbit.dist);
        this.position.copy(t).add(this.tmp);
        return true;
      }
    }
    if (!moving) return false;
    const boost = k.has('AltLeft') ? 5 : 1;
    this.tmp.set(fx, fy, fz).normalize().multiplyScalar(this.speed * dt * boost).applyQuaternion(this.quaternion);
    this.position.add(this.tmp);
    return true;
  }
}
