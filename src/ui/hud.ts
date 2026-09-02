import * as THREE from 'three';
import * as P from '../galaxy/params';
import type { LodStats } from '../galaxy/lod';
import type { FarField } from '../render/farfield';
import type { FlyControls } from '../controls';
import type { Probe } from '../galaxy/probe';
import { PHASE_NAMES } from '../galaxy/stellar';
import type { StarSystem } from '../galaxy/system';

export interface AppState {
  time: number; timeSpeed: number; paused: boolean; exposure: number; autoExposure: boolean;
  budget: number; showFar: boolean; showDust: boolean; bloom: number; showOrbits: boolean;
}

const TIME_SPEEDS = [2.74e-9, 2.74e-8, 2.74e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1, 10, 100, 1000]; // Myr/s (1 j/s, 10 j/s, 100 j/s, 1 an/s ...)
const COMP_NAMES = ['bulbe', 'disque mince', 'disque épais', 'halo'];

function fmtTime(myr: number): string {
  if (myr < 1e-3) return `${(myr * 1e6).toFixed(2)} ans`;
  if (myr < 1) return `${(myr * 1e3).toFixed(1)} ka`;
  if (myr < 1000) return `${myr.toFixed(1)} Ma`;
  return `${(myr / 1000).toFixed(3)} Ga`;
}
function fmtSpeed(myrPerS: number): string {
  if (myrPerS < 5e-7) return `${(myrPerS * 1e6 * 365.25).toFixed(0)} j/s`;
  if (myrPerS < 1e-3) return `${(myrPerS * 1e6).toFixed(0)} ans/s`;
  if (myrPerS < 1) return `${(myrPerS * 1e3).toFixed(0)} ka/s`;
  if (myrPerS < 1000) return `${myrPerS.toFixed(0)} Ma/s`;
  return `${(myrPerS / 1000).toFixed(0)} Ga/s`;
}
function fmtDist(pc: number): string {
  if (pc < 1e-4) return `${(pc * 206265).toFixed(3)} UA`;
  if (pc < 0.01) return `${(pc * 206265).toFixed(1)} UA`;
  if (pc < 1000) return `${pc.toFixed(2)} pc`;
  return `${(pc / 1000).toFixed(2)} kpc`;
}
function fmtBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return n.toFixed(0);
}

export class Hud {
  private hud = document.getElementById('hud')!;
  private panel = document.getElementById('panel')!;
  private starEl = document.getElementById('star')!;
  private fps = 60;
  private lastT = performance.now();
  private frames = 0;
  private speedIdx = 9;
  private pressed = new Set<string>();
  private lookTarget: THREE.Vector3 | null = null;

  constructor(private state: AppState, private lod: { stats: LodStats }, _far: FarField, private controls: FlyControls) {
    this.buildPanel();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.pressed.add(e.code);
    });
  }

  private buildPanel(): void {
    const s = this.state;
    const row = (label: string, input: HTMLElement, val: HTMLElement) => {
      const l = document.createElement('label');
      l.append(label, input, val);
      this.panel.append(l);
    };
    const range = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = `${min}`; inp.max = `${max}`; inp.step = `${step}`; inp.value = `${get()}`;
      const v = document.createElement('span'); v.className = 'v'; v.textContent = fmt(get());
      inp.oninput = () => { set(parseFloat(inp.value)); v.textContent = fmt(get()); };
      inp.onkeydown = (e) => e.preventDefault();
      row(label, inp, v);
      return () => { inp.value = `${get()}`; v.textContent = fmt(get()); };
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.checked = get();
      inp.onchange = () => set(inp.checked);
      const v = document.createElement('span'); v.className = 'v';
      row(label, inp, v);
    };
    const title = document.createElement('div');
    title.textContent = 'Galaxie — 2×10¹¹ étoiles procédurales';
    title.style.marginBottom = '6px';
    this.panel.append(title);
    this.refreshers.push(range('temps (Ga)', 0, 22, 0.01, () => s.time / 1000, (v) => { s.time = v * 1000; }, (v) => v.toFixed(2)));
    this.refreshers.push(range('vitesse temps', 0, TIME_SPEEDS.length - 1, 1, () => this.speedIdx, (v) => { this.speedIdx = v; s.timeSpeed = TIME_SPEEDS[v]; }, (v) => fmtSpeed(TIME_SPEEDS[v])));
    check('pause', () => s.paused, (v) => { s.paused = v; });
    range('budget étoiles', 5, 6.9, 0.05, () => Math.log10(s.budget), (v) => { s.budget = Math.round(Math.pow(10, v)); }, (v) => fmtBig(Math.pow(10, v)));
    check('auto-exposition', () => s.autoExposure, (v) => { s.autoExposure = v; });
    this.refreshers.push(range('exposition (log)', -1, 5.5, 0.05, () => Math.log10(s.exposure), (v) => { s.exposure = Math.pow(10, v); s.autoExposure = false; }, (v) => v.toFixed(2)));
    range('bloom', 0, 1.5, 0.05, () => s.bloom, (v) => { s.bloom = v; }, (v) => v.toFixed(2));
    check('champ lointain', () => s.showFar, (v) => { s.showFar = v; });
    check('poussière', () => s.showDust, (v) => { s.showDust = v; });
    check('orbites', () => s.showOrbits, (v) => { s.showOrbits = v; });
    s.timeSpeed = TIME_SPEEDS[this.speedIdx];
  }
  private refreshers: (() => void)[] = [];

  handleKeys(controls: FlyControls, probe: Probe): void {
    const s = this.state;
    const p = this.pressed;
    if (p.has('KeyJ') && probe.nearest) {
      // saut à 40 UA de l'étoile la plus proche, dans le plan de son système
      const th = P.PATTERN_OMEGA * s.time;
      const c = Math.cos(th), sn = Math.sin(th);
      const q = probe.nearest.pos;
      const target = new THREE.Vector3(c * q.x - sn * q.y, sn * q.x + c * q.y, q.z);
      controls.position.copy(target).add(new THREE.Vector3(40 * 4.848e-6, 0, 8 * 4.848e-6));
      controls.lookAt(target);
      controls.speed = 1e-5;
    }
    if (p.has('KeyT')) s.paused = !s.paused;
    if (p.has('BracketRight')) { this.speedIdx = Math.min(TIME_SPEEDS.length - 1, this.speedIdx + 1); s.timeSpeed = TIME_SPEEDS[this.speedIdx]; }
    if (p.has('BracketLeft')) { this.speedIdx = Math.max(0, this.speedIdx - 1); s.timeSpeed = TIME_SPEEDS[this.speedIdx]; }
    if (p.has('KeyR')) { controls.position.set(P.SUN_POS.x, P.SUN_POS.y, P.SUN_POS.z); controls.lookAt(new THREE.Vector3(0, 0, 0)); controls.speed = 2; }
    if (p.has('KeyG')) { controls.position.set(-9000, -32000, 22000); controls.lookAt(new THREE.Vector3(0, 0, 0)); controls.speed = 3000; }
    if (p.has('KeyH')) { controls.position.set(0, 0, 45000); controls.lookAt(new THREE.Vector3(0, 0, 0)); controls.speed = 3000; }
    if (p.has('KeyF')) this.lookTarget = this.lookTarget ? null : new THREE.Vector3();
    if (p.has('KeyE')) s.autoExposure = !s.autoExposure;
    if (p.has('Digit0')) s.time = P.T_PRESENT;
    p.clear();
  }

  update(s: AppState, camPat: THREE.Vector3, probe: Probe, info: THREE.WebGLRenderer['info'], system: StarSystem | null): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastT > 500) { this.fps = (this.frames * 1000) / (now - this.lastT); this.frames = 0; this.lastT = now; for (const r of this.refreshers) r(); }
    if (this.lookTarget && probe.nearest) {
      // convertit la position (réf. motif) en monde
      const th = P.PATTERN_OMEGA * s.time;
      const c = Math.cos(th), sn = Math.sin(th);
      const q = probe.nearest.pos;
      this.lookTarget.set(c * q.x - sn * q.y, sn * q.x + c * q.y, q.z);
      this.controls.lookAt(this.lookTarget);
    }
    const st = this.lod.stats;
    const R = Math.sqrt(camPat.x * camPat.x + camPat.y * camPat.y);
    const lines = [
      `${this.fps.toFixed(0)} fps   draw ${info.render.calls}   étoiles GPU ${fmtBig(st.stars)} (${st.nodes} noeuds, ${st.ms.toFixed(1)} ms, ${st.iterations} it.)`,
      `t = ${fmtTime(s.time)}   ${s.paused ? 'pause' : fmtSpeed(s.timeSpeed)}   age galaxie ${(s.time / 1000).toFixed(2)} Ga`,
      `position R = ${fmtDist(R)}  z = ${fmtDist(camPat.z)}   vitesse ${fmtDist(this.controls.speed)}/s`,
      `flux min ${st.fluxMin.toExponential(1)} L☉/pc²   exposition ${s.exposure.toFixed(1)}${s.autoExposure ? ' (auto)' : ''}`,
      `noeud local : ${fmtBig(probe.nodeStars)} étoiles / (64 pc)³   à <10 pc : ${probe.within10pc}`,
    ];
    this.hud.textContent = lines.join('\n');

    const n = probe.nearest;
    if (n) {
      this.starEl.style.display = 'block';
      const ph = n.state.phase;
      const info2 = [
        `étoile la plus proche  #${n.index}`,
        `distance   ${fmtDist(n.dist)}`,
        `composante ${COMP_NAMES[n.comp]}`,
        `masse      ${n.mass < 0.1 ? n.mass.toFixed(3) : n.mass.toFixed(2)} M☉`,
        `âge        ${fmtTime(n.age)}  (née à ${fmtTime(n.birth)})`,
        `phase      ${PHASE_NAMES[ph]}`,
        `L = ${n.state.L.toExponential(2)} L☉   T = ${n.state.T.toFixed(0)} K`,
        `rayon      ${n.state.radius.toPrecision(3)} R☉`,
        this.lookTarget ? '[F] suivi actif' : '[F] pour viser',
      ];
      if (system) {
        info2.push('');
        if (system.companion) info2.push(`compagnon  ${system.companion.mass.toFixed(2)} M☉, a = ${system.companion.a.toFixed(1)} UA, ${PHASE_NAMES[system.companion.state.phase]}`);
        else info2.push('étoile simple');
        info2.push(`planètes   ${system.planets.length}  (ligne des glaces ${system.snowLine.toFixed(1)} UA)`);
        system.planets.forEach((p, i) => info2.push(`  ${i + 1}. ${p.kind.padEnd(16)} a=${p.a.toFixed(2)} UA  R=${p.radius.toFixed(1)} R⊕  P=${p.period < 1 ? (p.period * 365.25).toFixed(0) + ' j' : p.period.toFixed(1) + ' a'}`));
      }
      this.starEl.textContent = info2.join('\n');
    } else this.starEl.style.display = 'none';
  }
}
