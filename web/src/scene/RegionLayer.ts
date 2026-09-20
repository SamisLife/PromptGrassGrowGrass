/**
 * RegionLayer: the land around the plot, seen when the camera is pulled up.
 *
 * One instanced box per grid cell, tinted by the crop the USDA Cropland Data Layer says
 * dominates it. Fields that complement the user's plot glow and send a thin line home;
 * everything else is muted so the eye goes to the matches without a caption.
 *
 * NOT TO SCALE, on purpose and said so in the legend: a cell is ~750 m of real land, while
 * the plot in the middle is drawn thousands of times larger than life so it stays the same
 * object the user was just looking at.
 */
import * as THREE from 'three';
import { brand } from '../brand';
import type { FarmMatch, Region } from '../data/types';

export const CELL = 2.3;            // world units per grid cell
export const GROUND = -0.97;        // just under the slab of earth
const CLEARING = 1.35;              // keep this many world units free around the plot

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aInfo;   // x: match strength 0..1, y: field index (-1 = nobody farms it), z: random, w: 0 land / 1 rows / 2 trees
uniform float uRegion, uTime, uRadius, uSel, uHover;
varying vec3 vColor; varying vec4 vInfo; varying vec3 vN; varying vec3 vW; varying vec2 vTop; varying float vRise; varying float vR;
void main() {
  vec2 centre = instanceMatrix[3].xz;
  vR = length(centre) / uRadius;
  // the land arrives from the plot outwards
  float rise = clamp(uRegion * 1.9 - vR * 0.9, 0., 1.);
  rise = rise * rise * (3. - 2. * rise);
  vec4 p = instanceMatrix * vec4(position, 1.);
  float lift = aInfo.x * 0.42 * rise;
  if (aInfo.y >= 0. && abs(aInfo.y - uSel) < .5) lift += .38;
  else if (aInfo.y >= 0. && abs(aInfo.y - uHover) < .5) lift += .14;
  p.y += lift - (1. - rise) * 2.6;
  vColor = aColor; vInfo = aInfo; vN = normal; vW = p.xyz; vTop = position.xz; vRise = rise;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
}`;

const FRAG = /* glsl */ `
uniform float uRegion, uTime, uSel, uHover, uHasMatches;
uniform vec3 cAccent;
varying vec3 vColor; varying vec4 vInfo; varying vec3 vN; varying vec3 vW; varying vec2 vTop; varying float vRise; varying float vR;
void main() {
  float top = step(.5, vN.y);
  vec3 col = vColor;
  // fields read as fields: crop rows, or the dot grid of an orchard / hop yard / vineyard
  if (vInfo.w > 1.5) {
    vec2 g = fract(vW.xz * 2.6 + vInfo.z) - .5;
    col *= mix(.78, 1.16, smoothstep(.34, .2, length(g)));
  } else if (vInfo.w > .5) {
    float a = floor(vInfo.z * 4.) * .7854;
    col *= 1. + .085 * sin(dot(vW.xz, vec2(cos(a), sin(a))) * 15.);
  } else {
    col *= .92 + .1 * fract(sin(dot(floor(vW.xz * 3.), vec2(12.9898, 78.233))) * 43758.5453);
  }
  float light = mix(.5 + .18 * vN.x, 1., top);
  float match = vInfo.x;
  float sel = (vInfo.y >= 0. && abs(vInfo.y - uSel) < .5) ? 1. : 0.;
  float hov = (vInfo.y >= 0. && abs(vInfo.y - uHover) < .5) ? 1. : 0.;
  // everything that is not a match steps back
  float keep = max(max(match, sel), hov * .7);
  vec3 grey = vec3(dot(col, vec3(.3, .55, .15)));
  col = mix(mix(grey, col, .42) * .34, col * 1.25, mix(1., keep, uHasMatches));
  col *= light;
  float edge = smoothstep(.40, .49, max(abs(vTop.x), abs(vTop.y))) * top;
  float pulse = .55 + .45 * sin(uTime * 2.2 + vInfo.z * 6.28);
  col += cAccent * match * (.16 + .2 * pulse + edge * .85);
  col += cAccent * sel * (.18 + edge * .9);
  col += vec3(.10) * hov;
  float alpha = vRise * (1. - smoothstep(.86, 1.06, vR));
  if (alpha < .01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const TREES = new Set(['orchard', 'vineyard', 'hops_herbs', 'forest']);
const LAND_HEIGHT: Record<string, number> = { forest: .5, shrub: .24, wetland: .12, water: .06, developed: .3, barren: .16, pasture: .2, fallow: .18, nodata: .05 };

export class RegionLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private info: THREE.InstancedBufferAttribute | null = null;
  private lines = new THREE.Group();
  private ring: THREE.Mesh;
  private uniforms = {
    uRegion: { value: 0 }, uTime: { value: 0 }, uRadius: { value: 1 }, uSel: { value: -1 }, uHover: { value: -1 }, uHasMatches: { value: 0 },
    cAccent: { value: new THREE.Color(brand.colors.accent) },
  };
  private region: Region | null = null;
  private fieldIndex = new Map<string, number>();
  private matchKey = '';
  private clear = { x: 3, z: 2 };
  amount = 0;                                  // 0 = at the plot, 1 = over the region (animated)

  constructor() {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), new THREE.MeshBasicMaterial({ color: brand.colors.accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = GROUND + 0.02;
    this.group.add(this.ring, this.lines);
    this.group.visible = false;
  }

  get ready(): boolean { return !!this.mesh; }
  get half(): number { return this.region ? (this.region.n * CELL) / 2 : 30; }

  /** world position of a field's centroid, on top of the land */
  fieldPos(id: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const f = this.region?.fields[this.fieldIndex.get(id) ?? -1];
    if (!f || !this.region) return null;
    const mid = (this.region.n - 1) / 2;
    return out.set((f.cx - mid) * CELL, GROUND + 0.75, (f.cy - mid) * CELL);
  }

  /** the field under a point on the ground plane, if somebody farms it */
  fieldAt(x: number, z: number): string | null {
    const r = this.region;
    if (!r) return null;
    const gx = Math.floor(x / CELL + r.n / 2), gy = Math.floor(z / CELL + r.n / 2);
    if (gx < 0 || gy < 0 || gx >= r.n || gy >= r.n) return null;
    if (Math.abs(x) < this.clear.x && Math.abs(z) < this.clear.z) return null;
    const idx = r.fieldOf[gy * r.n + gx];
    return idx >= 0 ? r.fields[idx].id : null;
  }

  setRegion(region: Region | null, plotW: number, plotL: number): void {
    if (region === this.region) return;
    this.region = region;
    this.matchKey = '';
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh = null; this.info = null; }
    this.fieldIndex.clear();
    if (!region) return;
    region.fields.forEach((f, i) => this.fieldIndex.set(f.id, i));
    this.clear = { x: plotW / 2 + CLEARING, z: plotL / 2 + CLEARING };
    this.ring.scale.setScalar(Math.hypot(this.clear.x, this.clear.z) + 0.15);

    const n = region.n, mid = (n - 1) / 2;
    const byCode = new Map(region.legend.map((l) => [l.code, l]));
    const keep: number[] = [];
    for (let i = 0; i < n * n; i++) {
      const x = ((i % n) - mid) * CELL, z = (((i / n) | 0) - mid) * CELL;
      if (Math.abs(x) < this.clear.x && Math.abs(z) < this.clear.z) continue;
      keep.push(i);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, -0.5, 0);                                   // origin on the top face: a cell's height grows downwards
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, keep.length);
    const colors = new Float32Array(keep.length * 3), info = new Float32Array(keep.length * 4);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    keep.forEach((i, k) => {
      const code = region.cells[i], l = byCode.get(code), fam = l?.family ?? 'nodata', r = rnd();
      const farmed = region.fieldOf[i] >= 0;
      const top = GROUND + (farmed ? 0.3 + r * 0.16 + (TREES.has(fam) ? 0.12 : 0) : (LAND_HEIGHT[fam] ?? 0.15) + r * 0.06);
      m.makeScale(CELL * 0.93, 1.6, CELL * 0.93).setPosition(((i % n) - mid) * CELL, top, (((i / n) | 0) - mid) * CELL);
      mesh.setMatrixAt(k, m);
      c.set(l?.color ?? '#22262a');
      colors.set([c.r, c.g, c.b], k * 3);
      info.set([0, region.fieldOf[i], r, !farmed && fam !== 'forest' ? 0 : TREES.has(fam) ? 2 : 1], k * 4);
    });
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    this.info = new THREE.InstancedBufferAttribute(info, 4);
    geo.setAttribute('aInfo', this.info);
    mesh.frustumCulled = false;
    this.uniforms.uRadius.value = this.half;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /** light the complementary fields and draw their lines home */
  setMatches(matches: FarmMatch[]): void {
    const key = matches.map((m) => m.fieldId + m.score).join('|');
    if (key === this.matchKey || !this.region || !this.info) return;
    this.matchKey = key;
    const strength = new Map<number, number>();
    const best = matches[0]?.score || 1;
    for (const m of matches) strength.set(this.fieldIndex.get(m.fieldId) ?? -2, 0.55 + 0.45 * (m.score / best));
    const a = this.info.array as Float32Array;
    for (let k = 0; k < a.length / 4; k++) a[k * 4] = strength.get(a[k * 4 + 1]) ?? 0;
    this.info.needsUpdate = true;
    this.uniforms.uHasMatches.value = matches.length ? 1 : 0;

    for (const l of [...this.lines.children]) { this.lines.remove(l); (l as THREE.Line).geometry.dispose(); ((l as THREE.Line).material as THREE.Material).dispose(); }
    const home = new THREE.Vector3(0, 0.35, 0);
    for (const m of matches) {
      const to = this.fieldPos(m.fieldId);
      if (!to) continue;
      const midPt = home.clone().lerp(to, 0.5);
      midPt.y += 1.6 + home.distanceTo(to) * 0.16;
      const pts = new THREE.QuadraticBezierCurve3(home, midPt, to).getPoints(40);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: brand.colors.accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      line.userData.id = m.fieldId;
      this.lines.add(line);
    }
  }

  update(dt: number, on: boolean, selected: string | null, hover: string | null): void {
    const target = on && this.mesh ? 1 : 0;
    this.amount += (target - this.amount) * (1 - Math.exp(-(on ? 1.5 : 3.2) * dt));
    if (Math.abs(target - this.amount) < 0.002) this.amount = target;
    this.group.visible = this.amount > 0.004;
    const u = this.uniforms;
    u.uRegion.value = this.amount;
    u.uTime.value += dt;
    u.uSel.value = selected ? this.fieldIndex.get(selected) ?? -1 : -1;
    u.uHover.value = hover ? this.fieldIndex.get(hover) ?? -1 : -1;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = this.amount * 0.55;
    // lines arrive after the land has
    const k = Math.max(0, this.amount * 2.2 - 1.2);
    for (const l of this.lines.children) {
      const mat = (l as THREE.Line).material as THREE.LineBasicMaterial;
      const focus = !selected || l.userData.id === selected;
      mat.opacity = k * (focus ? (selected ? 0.95 : 0.55) : 0.12);
    }
  }
}
