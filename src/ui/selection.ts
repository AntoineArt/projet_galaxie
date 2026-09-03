// Sélection d'un astre à la souris : étoiles (sonde), corps du système courant, objets (amas, nébuleuses, Sgr A*).
import * as THREE from 'three';
import type { NearStar } from '../galaxy/probe';
import type { ProbeClient } from '../galaxy/probeclient';
import type { Objects, Pickable } from '../render/objects';
import type { SystemRenderer } from '../render/system';
import type { BodyPos, StarSystem } from '../galaxy/system';
import { AU_PC } from '../galaxy/system';
import { PHASE, PHASE_NAMES, tMS } from '../galaxy/stellar';

export type Selection =
  | { kind: 'star'; star: NearStar }
  | { kind: 'body'; systemId: string; body: BodyPos; label: string; radius: number }
  | { kind: 'object'; obj: Pickable };

const COMP_NAMES = ['bulbe', 'disque mince', 'disque épais', 'halo'];

function fmtTime(myr: number): string {
  if (myr < 1e-3) return `${(myr * 1e6).toFixed(0)} ans`;
  if (myr < 1) return `${(myr * 1e3).toFixed(1)} ka`;
  if (myr < 1000) return `${myr.toFixed(1)} Ma`;
  return `${(myr / 1000).toFixed(3)} Ga`;
}
export function fmtDist(pc: number): string {
  if (pc < 1e-6) return `${(pc * 206265 * 1.496e8).toFixed(0)} km`;
  if (pc < 1e-4) return `${(pc * 206265).toFixed(3)} UA`;
  if (pc < 0.01) return `${(pc * 206265).toFixed(1)} UA`;
  if (pc < 1000) return `${pc.toFixed(2)} pc`;
  return `${(pc / 1000).toFixed(2)} kpc`;
}

export class SelectionManager {
  current: Selection | null = null;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private probe: ProbeClient, private objects: Objects, private systemR: SystemRenderer) {}

  /** rayon de sélection : coordonnées écran -> direction monde */
  private rayWorld(x: number, y: number, camera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
    const nx = (x / innerWidth) * 2 - 1, ny = 1 - (y / innerHeight) * 2;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    return out.set(nx * t * camera.aspect, ny * t, -1).normalize().applyQuaternion(camera.quaternion);
  }

  async pick(x: number, y: number, camera: THREE.PerspectiveCamera, camWorld: THREE.Vector3, camPat: THREE.Vector3, theta: number, time: number, fluxMin: number): Promise<Selection | null> {
    const dir = this.rayWorld(x, y, camera, this.dir).clone();
    let best: Selection | null = null, bestScore = 0.025; // ~1,4°
    const c = Math.cos(theta), s = Math.sin(theta);
    // objets étendus : score = angle au-delà du rayon apparent
    for (const obj of this.objects.pickables) {
      const q = obj.pos;
      const rx = c * q.x - s * q.y - camWorld.x, ry = s * q.x + c * q.y - camWorld.y, rz = q.z - camWorld.z;
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (d < 1e-6) continue;
      const cosA = (rx * dir.x + ry * dir.y + rz * dir.z) / d;
      if (cosA < 0.995) continue;
      const score = Math.max(0, Math.acos(Math.min(1, cosA)) - Math.atan(obj.radius / d));
      if (score < bestScore) { bestScore = score; best = { kind: 'object', obj }; }
    }
    // corps du système courant (marqueurs de quelques pixels : tolérance angulaire, bonus)
    const sys = this.systemR.system;
    if (sys) {
      for (const b of this.systemR.bodies) {
        if (b.body.kind === 'star') continue; // l'étoile primaire est gérée par la sonde
        const d = b.rel.length();
        if (d < 1e-12) continue;
        const cosA = b.rel.dot(dir) / d;
        if (cosA < 0.995) continue;
        const score = Math.max(0, Math.acos(Math.min(1, cosA)) - Math.atan(b.body.radius / d)) * 0.5;
        if (score < bestScore) { bestScore = score; best = { kind: 'body', systemId: sys.id, body: b.body, label: b.label, radius: b.body.radius }; }
      }
    }
    // étoiles : direction dans le référentiel du motif
    const cm = Math.cos(-theta), sm = Math.sin(-theta);
    const dirPat = new THREE.Vector3(cm * dir.x - sm * dir.y, sm * dir.x + cm * dir.y, dir.z);
    const star = await this.probe.pick(camPat, dirPat, time, fluxMin);
    if (star) {
      const q = star.pos;
      const rx = c * q.x - s * q.y - camWorld.x, ry = s * q.x + c * q.y - camWorld.y, rz = q.z - camWorld.z;
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      const score = Math.acos(Math.min(1, (rx * dir.x + ry * dir.y + rz * dir.z) / d));
      if (score < bestScore) { bestScore = score; best = { kind: 'star', star }; }
    }
    if (!best || best.kind !== 'star') this.probe.clearSelection();
    this.current = best;
    return best;
  }

  clear(): void { this.current = null; this.probe.clearSelection(); }

  /** position monde (double) de la sélection à cette frame ; null si elle n'est plus résolvable */
  worldPos(camWorld: THREE.Vector3, theta: number, out: THREE.Vector3): THREE.Vector3 | null {
    const sel = this.current;
    if (!sel) return null;
    const c = Math.cos(theta), s = Math.sin(theta);
    if (sel.kind === 'star') {
      const st = this.probe.selected;
      if (!st) return null;
      const q = st.pos;
      return out.set(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
    }
    if (sel.kind === 'object') {
      const q = sel.obj.pos;
      return out.set(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
    }
    const sys = this.systemR.system;
    if (!sys || sys.id !== sel.systemId) return null;
    const b = this.systemR.bodies.find((x) => x.body.kind === sel.body.kind && x.body.planet === sel.body.planet && x.body.moon === sel.body.moon);
    if (!b) return null;
    void camWorld;
    return out.copy(b.abs);
  }

  /** rayon physique (pc) et distance de visite conseillée (pc) */
  radius(): number {
    const sel = this.current;
    if (!sel) return 0;
    if (sel.kind === 'star') {
      const st = this.probe.selected;
      if (!st) return 1e-8;
      // trou noir : rayon de l'ombre (2,6 r_s), agrandi ×3 comme dans le rendu
      if (st.state.phase === PHASE.BLACK_HOLE) return 3 * 9.6e-14 * st.mass; // r_s (x3 comme dans le rendu)
      // coquilles en expansion (mêmes lois que star.vert.glsl)
      const tms = tMS(st.mass);
      if (st.state.phase === PHASE.PLANETARY_NEBULA) return 0.05 + 0.5 * ((st.age - tms * 1.15) / 0.03);
      if (st.state.phase === PHASE.SUPERNOVA) { const tsn = st.age - tms * 1.1; return tsn > 1e-3 ? Math.pow(tsn * 1e3, 0.4) : 1e-6; }
      return Math.max(st.state.radius, 1e-3) * 2.25e-8;
    }
    if (sel.kind === 'object') return sel.obj.radius;
    return sel.radius;
  }
  visitDistance(): number {
    const sel = this.current;
    if (!sel) return 1;
    if (sel.kind === 'star') {
      const ph = this.probe.selected?.state.phase;
      const compact = ph === PHASE.WHITE_DWARF || ph === PHASE.NEUTRON_STAR || ph === PHASE.BLACK_HOLE;
      if (ph === PHASE.PLANETARY_NEBULA || ph === PHASE.SUPERNOVA) return Math.max(this.radius() * 3.5, 40 * AU_PC);
      if (ph === PHASE.BLACK_HOLE) return Math.max(this.radius() * 40, 2e-12);
      return compact ? Math.max(this.radius() * 45, 2e-12) : Math.max(40 * AU_PC, this.radius() * 30);
    }
    if (sel.kind === 'object') return sel.obj.kind === 'trou noir supermassif' ? 0.3 : sel.obj.kind === 'galaxie' ? sel.obj.radius * 4 : sel.obj.radius * 2.5;
    return Math.max(sel.radius * 14, 2e-9);
  }

  title(): string {
    const sel = this.current;
    if (!sel) return '';
    if (sel.kind === 'star') {
      const st = this.probe.selected;
      const ph = st?.state.phase ?? 0;
      const name = ph === PHASE.BLACK_HOLE ? 'trou noir stellaire' : ph === PHASE.NEUTRON_STAR ? 'étoile à neutrons' : ph === PHASE.WHITE_DWARF ? 'naine blanche' : ph === PHASE.SUPERNOVA ? 'supernova' : ph === PHASE.PLANETARY_NEBULA ? 'nébuleuse planétaire' : ph === PHASE.BROWN_DWARF ? 'naine brune' : 'étoile';
      return `${name}  #${st?.index ?? ''}`;
    }
    if (sel.kind === 'object') return sel.obj.kind;
    return sel.label;
  }

  lines(system: StarSystem | null, camWorld: THREE.Vector3, theta: number): string[] {
    const sel = this.current;
    if (!sel) return [];
    const pos = this.worldPos(camWorld, theta, this.tmp);
    const dist = pos ? pos.distanceTo(camWorld) : 0;
    const out = [`distance   ${fmtDist(dist)}`];
    if (sel.kind === 'star') {
      const n = this.probe.selected;
      if (!n) return out;
      out.push(`composante ${COMP_NAMES[n.comp]}`, `masse      ${n.mass < 0.1 ? n.mass.toFixed(3) : n.mass.toFixed(2)} M☉`, `âge        ${fmtTime(n.age)}  (née à ${fmtTime(n.birth)})`, `phase      ${PHASE_NAMES[n.state.phase]}`);
      if (n.state.phase === PHASE.BLACK_HOLE) out.push(`rayon de Schwarzschild ${(2.95 * n.mass).toFixed(0)} km`);
      else out.push(`L = ${n.state.L.toExponential(2)} L☉   T = ${n.state.T.toFixed(0)} K`, `rayon      ${n.state.radius.toPrecision(3)} R☉`);
      if (system) {
        out.push('');
        if (system.companion) out.push(`compagnon  ${system.companion.mass.toFixed(2)} M☉, a = ${system.companion.a.toFixed(1)} UA, ${PHASE_NAMES[system.companion.state.phase]}`);
        else out.push('étoile simple');
        out.push(`planètes   ${system.planets.length}  (ligne des glaces ${system.snowLine.toFixed(1)} UA)`);
        system.planets.forEach((p, i) => out.push(`  ${i + 1}. ${(p.name ?? p.kind).padEnd(16)} a=${p.a.toFixed(2)} UA  R=${p.radius.toFixed(1)} R⊕  ${p.moons.length ? p.moons.length + ' lune' + (p.moons.length > 1 ? 's' : '') : ''}${p.rings ? ' anneaux' : ''}`));
        for (const b of system.belts) out.push(`  ceinture ${b.kind === 'Kuiper' ? 'de Kuiper' : "d'astéroïdes"}  ${b.inner.toFixed(1)} à ${b.outer.toFixed(1)} UA`);
        if (system.comets.length) out.push(`  comètes    ${system.comets.length}`);
        if (n.state.phase === PHASE.NEUTRON_STAR) out.push(`  pulsar     période ${system.pulsarPeriod.toFixed(3)} s`);
      }
      return out;
    }
    if (sel.kind === 'object') return out.concat(sel.obj.info);
    if (!system) return out;
    const b = sel.body;
    if (b.kind === 'companion' && system.companion) {
      const C = system.companion;
      out.push(`masse      ${C.mass.toFixed(2)} M☉`, `phase      ${PHASE_NAMES[C.state.phase]}`, `L = ${C.state.L.toExponential(2)} L☉   T = ${C.state.T.toFixed(0)} K`, `orbite     a = ${C.a.toFixed(1)} UA, P = ${C.period.toFixed(1)} a`);
      return out;
    }
    if (b.kind === 'comet') {
      const cm = system.comets[b.planet];
      if (cm) out.push(`type       comète`, `périhélie  ${(cm.a * (1 - cm.e)).toFixed(2)} UA, aphélie ${(cm.a * (1 + cm.e)).toFixed(1)} UA`, `orbite     e = ${cm.e.toFixed(2)}, P = ${cm.period.toFixed(1)} a, i = ${(cm.inc * 57.3).toFixed(0)}°`);
      return out;
    }
    const pl = system.planets[b.planet];
    if (!pl) return out;
    if (b.kind === 'planet') {
      out.push(`type       ${pl.kind}${pl.name ? ' (' + pl.name + ')' : ''}`, `rayon      ${pl.radius.toFixed(2)} R⊕   masse ${pl.mass.toFixed(1)} M⊕`, `orbite     a = ${pl.a.toFixed(2)} UA, e = ${pl.e.toFixed(2)}, P = ${pl.period < 1 ? (pl.period * 365.25).toFixed(0) + ' j' : pl.period.toFixed(1) + ' a'}`);
      const Teq = 278 * Math.pow(system.primary.L, 0.25) / Math.sqrt(pl.a) * Math.pow(0.7, 0.25);
      out.push(`T équilibre ${Teq.toFixed(0)} K${Teq > 240 && Teq < 330 && pl.kind !== 'géante gazeuse' && pl.kind !== 'géante de glace' ? '  (zone habitable)' : ''}`);
      if (pl.moons.length) out.push(`lunes      ${pl.moons.length}`);
      if (pl.rings) out.push(`anneaux    ${pl.rings.inner.toFixed(1)} à ${pl.rings.outer.toFixed(1)} rayons planétaires`);
    } else {
      const m = pl.moons[b.moon];
      if (m) out.push(`type       lune ${m.kind}${m.name ? ' (' + m.name + ')' : ''}`, `rayon      ${m.radius.toFixed(2)} R⊕`, `orbite     a = ${(m.a * 1.496e8).toFixed(0)} km, P = ${(m.period * 365.25).toFixed(1)} j`);
    }
    return out;
  }
}
