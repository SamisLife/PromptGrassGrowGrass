/**
 * FieldScene: the living 3D plot.
 *
 * Reads the app store every frame (no React re-renders in the hot path) and
 * drives the shaders in shaders.ts. HTML overlays (zone tags, build handles,
 * dimension labels) are positioned through `project()` from the React side.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { brand } from '../brand';
import { MOISTURE } from '../data/sim/advice';
import { sampleSeries, useApp } from '../data/store';
import type { Plot, Zone } from '../data/types';
import { makeProbe } from './Probe';
import { GROUND, RegionLayer } from './RegionLayer';
import { MAX_ZONES, SLAB_FRAG, SLAB_VERT, SPROUT_FRAG, SPROUT_VERT } from './shaders';

const LONG_SIDE = 6;          // world units the plot's longest side is fitted to
const THICKNESS = 0.95;
const FRONT_TAU = 14;         // seconds: shape of the estimated front's advance
const SPROUTS = 1500;

type CamMode = 'welcome' | 'build' | 'live' | 'pour' | 'far' | 'region';
// Scrolling out past ZOOM_OUT_AT lifts the camera over the region; scrolling back in under ZOOM_IN_AT brings it home.
const ZOOM_OUT_AT = 21, ZOOM_IN_AT = 34, FARM_DIST = 40;
const CAM: Record<CamMode, { dir: [number, number, number]; dist: number; target: [number, number, number] }> = {
  welcome: { dir: [-0.55, 0.42, 0.72], dist: 12.5, target: [0, -0.2, 0] },
  build: { dir: [0, 0.86, 0.5], dist: 11.5, target: [0, -0.3, 0.2] },
  live: { dir: [-0.5, 0.52, 0.69], dist: 11.4, target: [0, -0.55, 0] },
  pour: { dir: [0.0, 0.66, 0.75], dist: 9.8, target: [0, -0.45, 0] },
  far: { dir: [-0.45, 0.6, 0.66], dist: 13, target: [0, -0.4, 0] },
  region: { dir: [-0.36, 0.74, 0.57], dist: 88, target: [0, GROUND, 0] },
};
type Pose = { dir: [number, number, number]; dist: number; target: [number, number, number] };

const col = (hex: string) => new THREE.Color(hex);
const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

export interface Projected { x: number; y: number; visible: boolean }

export class FieldScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 600);
  readonly controls: OrbitControls;
  onFrame: (() => void) | null = null;

  /** cm -> world units. Frozen while a resize handle is being dragged. */
  scale = LONG_SIDE / 30;
  private scaleTarget = this.scale;
  freezeScale = false;
  private dispW = 30;   // displayed (animated) plot size, cm
  private dispL = 15;

  private uniforms: Record<string, THREE.IUniform>;
  private slab: THREE.Mesh;
  private glass: THREE.Group;
  private sprouts: THREE.Mesh;
  private probeGroup = new THREE.Group();
  private probes = new Map<string, ReturnType<typeof makeProbe>>();
  private link: THREE.Line;
  private motes: THREE.Points;
  private shadow: THREE.Mesh;
  readonly region = new RegionLayer();
  private poseKey = '';
  private pose: Pose = CAM.welcome;
  private camLockUntil = 0;

  private zoneMoist = new Map<string, number>();
  private frontR = 0;
  private pourActive = 0;
  private pourBlend = 0;    // 0 = show pre-pour baseline, 1 = show live values
  private doneAt: number | null = null;
  private camMode: CamMode = 'welcome';
  private camAnimating = true;
  private shiftX = 0;
  private shiftY = 0;
  private userMoved = false;
  private lastT = performance.now();
  private raf = 0;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private landPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(GROUND + 0.4));
  private disposed = false;
  private debugTimer: ReturnType<typeof setInterval> | undefined;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private debugFrame: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const debug = new URLSearchParams(location.search).has('debug');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: debug });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);

    const s = brand.scene;
    this.uniforms = {
      uTime: { value: 0 }, uZoneCount: { value: 0 },
      uZonePos: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector2()) },
      uZoneKnown: { value: new Array(MAX_ZONES).fill(0) },
      cSoilUnknown: { value: col(s.soilUnknown) },
      uZoneMoist: { value: new Array(MAX_ZONES).fill(0) }, uZoneTemp: { value: new Array(MAX_ZONES).fill(-1) },
      uZoneGlow: { value: new Array(MAX_ZONES).fill(0) },
      uPour: { value: new THREE.Vector3() }, uPourActive: { value: 0 }, uPourWet: { value: 0.95 }, uPourAge: { value: -1 },
      uPlotSize: { value: new THREE.Vector2(6, 3) }, uThickness: { value: THICKNESS },
      uBlueprint: { value: 0 }, uAlive: { value: 0 }, uGrid: { value: 0.5 }, uLens: { value: 0 }, uSelected: { value: -1 }, uScan: { value: -1 },
      cSoilDry: { value: col(s.soilDry) }, cSoilWet: { value: col(s.soilWet) }, cSoilSub: { value: col(s.soilSub) }, cSoilDeep: { value: col(s.soilDeep) },
      cWater: { value: col(s.water) }, cWarm: { value: col(s.warm) }, cCool: { value: col(s.cool) }, cAgent: { value: col(s.agent) },
      cBlueprint: { value: col(s.blueprint) }, cBlueprintLine: { value: col(s.blueprintLine) }, cAccent: { value: col(brand.colors.accent) },
      cAlive: { value: col(s.sproutAlive) }, cDead: { value: col(s.sproutDead) },
    };

    // --- the slab of earth
    this.slab = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SLAB_VERT, fragmentShader: SLAB_FRAG }),
    );
    this.scene.add(this.slab);

    // --- clear container walls (shown for container-sized plots, like the demo)
    this.glass = new THREE.Group();
    const glassBox = new THREE.BoxGeometry(1, 1, 1);
    const pane = new THREE.Mesh(glassBox, new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glassBox), new THREE.LineBasicMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.28 }));
    this.glass.add(pane, edges);
    this.scene.add(this.glass);

    // --- sprouts
    const blade = new THREE.PlaneGeometry(0.03, 1, 1, 3);
    blade.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.setAttribute('position', blade.getAttribute('position'));
    const off = new Float32Array(SPROUTS * 2), rnd = new Float32Array(SPROUTS * 3);
    let clumpX = 0, clumpY = 0;
    for (let i = 0; i < SPROUTS; i++) {
      // clumped, so it reads as seedlings and not as a lawn
      if (i % 6 === 0) { clumpX = Math.random() - 0.5; clumpY = Math.random() - 0.5; }
      off[i * 2] = THREE.MathUtils.clamp(clumpX + (Math.random() - 0.5) * 0.03, -0.5, 0.5);
      off[i * 2 + 1] = THREE.MathUtils.clamp(clumpY + (Math.random() - 0.5) * 0.05, -0.5, 0.5);
      rnd.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 3));
    geo.instanceCount = SPROUTS;
    this.sprouts = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SPROUT_VERT, fragmentShader: SPROUT_FRAG, side: THREE.DoubleSide }));
    this.sprouts.frustumCulled = false;
    this.scene.add(this.sprouts);

    // --- probes, and the measured line between them
    this.scene.add(this.probeGroup);
    this.link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: col(brand.colors.accent), dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.85 }));
    this.scene.add(this.link);

    // --- grounding: a soft contact shadow, drifting motes, light
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    this.scene.add(this.region.group);

    const moteGeo = new THREE.BufferGeometry();
    const mp = new Float32Array(260 * 3);
    for (let i = 0; i < 260; i++) mp.set([(Math.random() - 0.5) * 16, Math.random() * 6 - 1, (Math.random() - 0.5) * 12], i * 3);
    moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xd8ffc0, size: 0.035, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.motes);

    this.scene.add(new THREE.HemisphereLight(0xdfeee0, 0x1a140e, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(4.5, 8.5, 3.5);
    this.scene.add(sun);

    // --- camera
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.rotateSpeed = 0.6;
    this.controls.addEventListener('start', () => {
      if (performance.now() < this.camLockUntil) return;       // a zoom-level change is in flight: the scroll that caused it must not cancel it
      this.camAnimating = false; this.userMoved = true;
    });
    this.applyCam(CAM.welcome, 1);

    if (new URLSearchParams(location.search).has('debug')) {
      let frames = 0;
      this.debugTimer = setInterval(() => {
        const u = this.uniforms;
        console.log('[scene]', JSON.stringify({ frames, pourActive: u.uPourActive.value, pour: u.uPour.value.toArray(), age: u.uPourAge.value, moist: u.uZoneMoist.value, alive: u.uAlive.value, phase: useApp.getState().pour.phase, src: useApp.getState().pour.source }));
      }, 3000);
      this.debugFrame = () => { frames++; };
    }
    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  // ------------------------------------------------------------------ public
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    clearInterval(this.debugTimer);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    });
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      m.dispose();
    }
    geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
    this.controls.dispose();
    this.renderer.dispose();
  }

  /** plot cm -> world */
  toWorld(x: number, y: number, plot: Plot, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set((x - plot.width / 2) * this.scale, 0, (y - plot.length / 2) * this.scale);
  }

  project(v: THREE.Vector3): Projected {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width, y: (-p.y * 0.5 + 0.5) * r.height, visible: p.z < 1 };
  }

  /** screen point -> plot cm on the soil surface */
  pick(clientX: number, clientY: number, plot: Plot): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    return { x: hit.x / this.scale + plot.width / 2, y: hit.z / this.scale + plot.length / 2 };
  }

  setDragging(on: boolean): void { this.controls.enabled = !on; }

  /** screen point -> the neighbouring field under it (only while zoomed out) */
  pickFarm(clientX: number, clientY: number): string | null {
    if (this.region.amount < 0.6) return null;
    const r = this.canvas.getBoundingClientRect();
    // (setViewOffset lives in the projection matrix, so the sideways slide of the picture is already accounted for)
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.landPlane, hit)) return null;
    return this.region.fieldAt(hit.x, hit.z);
  }

  // ------------------------------------------------------------------- frame
  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private applyCam(pose: Pose, k: number): void {
    const portrait = this.camera.aspect < 1 ? Math.min(2.1, 0.95 / this.camera.aspect) : 1;
    const want = new THREE.Vector3(...pose.dir).normalize().multiplyScalar(pose.dist * portrait).add(new THREE.Vector3(...pose.target));
    this.camera.position.lerp(want, k);
    this.controls.target.lerp(new THREE.Vector3(...pose.target), k);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = performance.now();
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.update(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
    this.debugFrame?.();
  };

  private update(dt: number): void {
    const st = useApp.getState();
    const cfg = st.config;
    if (!cfg) return;
    const u = this.uniforms;
    const now = performance.now();
    u.uTime.value += dt;

    const plot = st.draft?.plot ?? cfg.plot;
    const zones: Zone[] = (st.draft?.zones ?? cfg.zones).slice(0, MAX_ZONES);
    const building = st.stage === 'build';

    // --- size & scale
    this.scaleTarget = LONG_SIDE / Math.max(plot.width, plot.length);
    if (!this.freezeScale) this.scale = damp(this.scale, this.scaleTarget, 6, dt);
    this.dispW = damp(this.dispW, plot.width, 14, dt);
    this.dispL = damp(this.dispL, plot.length, 14, dt);
    const W = this.dispW * this.scale, Lz = this.dispL * this.scale;
    u.uPlotSize.value.set(W, Lz);
    this.slab.scale.set(W, THICKNESS, Lz);
    this.slab.position.y = -THICKNESS / 2;
    const container = Math.max(plot.width, plot.length) <= 120;
    this.glass.visible = container;
    this.glass.scale.set(W + 0.06, THICKNESS + 0.42, Lz + 0.06);
    this.glass.position.y = -THICKNESS / 2 + 0.2;
    this.shadow.scale.set(W * 2.1 + 3, Lz * 2.1 + 3, 1);
    this.shadow.position.y = -THICKNESS - 0.02;
    // blueprint grid: 1 cm, 10 cm or 1 m squares depending on how big the plot is
    const big = Math.max(plot.width, plot.length);
    u.uGrid.value = (big <= 60 ? 1 : big <= 600 ? 10 : 100) * this.scale;

    // --- modes
    u.uBlueprint.value = damp(u.uBlueprint.value, building ? 1 : 0, building ? 7 : 1.6, dt);
    const aliveTarget = st.stage === 'live' ? 1 : st.stage === 'calibrate' ? 0.25 : 0;
    u.uAlive.value = damp(u.uAlive.value, aliveTarget, st.stage === 'live' ? 0.9 : 3, dt);
    u.uLens.value = st.lens === 'moisture' ? 1 : st.lens === 'temperature' ? 2 : 0;
    u.uSelected.value = st.stage === 'live' && st.drawer ? zones.findIndex((z) => z.id === st.selectedZone) : -1;
    u.uScan.value = st.scanAt != null && now - st.scanAt < 1700 ? (now - st.scanAt) / 1700 : -1;

    // --- pour choreography
    const pour = st.pour;
    const src = zones.find((z) => z.id === pour.source), dst = zones.find((z) => z.id === pour.target) ?? zones.find((z) => z.id !== pour.source);
    const pouring = (pour.phase === 'running' || pour.phase === 'done' || pour.phase === 'timeout') && !!src && !st.replay.active;
    if (pouring && src && pour.t0) {
      const a = this.toWorld(src.x, src.y, plot), b = dst ? this.toWorld(dst.x, dst.y, plot) : a;
      const D = Math.max(0.5, a.distanceTo(b));
      const elapsed = (Date.now() - pour.t0) / 1000;
      u.uPour.value.set(a.x, a.z, this.frontR);
      u.uPourAge.value = elapsed;
      let target: number;
      if (pour.phase === 'done' && pour.t1) {
        this.doneAt ??= now;
        const since = (now - this.doneAt) / 1000;
        // confirmed by probe B: close the gap, then let it soak the whole plot
        target = D * 1.12 + Math.max(0, since - 1.2) * 0.55;
        if (Date.now() - pour.t1 > 60000) target = 40;
        this.pourBlend = damp(this.pourBlend, since > 9 ? 1 : 0, 0.8, dt);
        this.pourActive = damp(this.pourActive, since > 9 ? 0 : 1, since > 9 ? 0.5 : 5, dt);
      } else {
        this.doneAt = null;
        // ESTIMATE: between the probes we cannot see the front. It advances on
        // a decelerating curve and never reaches B until probe B says so.
        target = 0.9 * D * (1 - 1 / (1 + elapsed / FRONT_TAU));
        this.pourBlend = damp(this.pourBlend, 0, 6, dt);
        this.pourActive = damp(this.pourActive, 1, 5, dt);
      }
      this.frontR = damp(this.frontR, target, pour.phase === 'done' ? 2.2 : 4, dt);
    } else {
      this.doneAt = null;
      this.pourActive = damp(this.pourActive, 0, 3, dt);
      this.pourBlend = damp(this.pourBlend, 1, 3, dt);
      if (this.pourActive < 0.01) { this.frontR = 0; u.uPourAge.value = -1; }
    }
    u.uPourActive.value = this.pourActive < 0.005 ? 0 : this.pourActive;

    // --- zones
    u.uZoneCount.value = zones.length;
    const threshold = st.profile?.drainageClass === 'fast' ? MOISTURE.low : MOISTURE.dry + 5;
    zones.forEach((z, i) => {
      const w = this.toWorld(z.x, z.y, plot);
      u.uZonePos.value[i].set(w.x, w.z);
      const live = st.live[z.id];
      const rep = st.replay.active ? sampleSeries(st.replay.series[z.id], st.replay.t) : null;
      const pct = rep ? rep.moisturePct : live?.moistureOnline ? live.moisturePct : null;
      u.uZoneKnown.value[i] = pct == null ? 0 : 1;
      const temp = rep ? rep.tempC : live?.tempOnline ? live.tempC : null;
      const base = pour.baseline[z.id];
      const shown = pct == null ? 12 : base != null && pouring ? base + (pct - base) * this.pourBlend : pct;
      const cur = damp(this.zoneMoist.get(z.id) ?? shown, shown, 2.5, dt);
      this.zoneMoist.set(z.id, cur);
      u.uZoneMoist.value[i] = cur / 100;
      u.uZoneTemp.value[i] = temp == null ? -1 : THREE.MathUtils.clamp((temp - 8) / 22, 0, 1);
      const g = st.glow[z.id];
      u.uZoneGlow.value[i] = g ? Math.max(0, 1 - (now - g) / 2600) : 0;

      // probe model
      let p = this.probes.get(z.id);
      if (!p) { p = makeProbe(); this.probes.set(z.id, p); this.probeGroup.add(p.group); }
      p.group.position.copy(w);
      p.route(-Lz / 2 - w.z, container);
      const online = live?.moistureOnline ?? false;
      p.group.visible = true;
      const beat = 0.6 + 0.4 * Math.sin(u.uTime.value * 5 + i * 2);
      p.led.emissive.set(online ? brand.colors.accent : brand.colors.danger);
      p.led.emissiveIntensity = online ? .7 + beat * .25 : .5;
      p.tempLed.emissive.set(live?.tempOnline ? brand.colors.accent : brand.colors.danger);
      p.tempLed.emissiveIntensity = live?.tempOnline ? .9 : .5;
      const thirsty = st.stage === 'live' && !pouring && pct != null && pct < threshold && (rep != null || (live?.moistureOnline ?? false));
      const ds = damp(p.drop.scale.x, thirsty ? 1 : 0, 5, dt);
      p.drop.scale.setScalar(ds);
      p.drop.visible = ds > 0.02;
      p.drop.position.y = 1.30 + Math.sin(u.uTime.value * 1.6 + i) * 0.07;
      p.drop.rotation.y += dt * 0.8;
    });
    for (const [id, p] of this.probes) if (!zones.some((z) => z.id === id)) { this.probeGroup.remove(p.group); this.probes.delete(id); }

    // measured line between the first two probes (build + pour)
    const showLink = zones.length >= 2 && (building || st.view === 'pour');
    this.link.visible = showLink;
    if (showLink) {
      const a = this.toWorld(zones[0].x, zones[0].y, plot), b = this.toWorld(zones[1].x, zones[1].y, plot);
      a.y = b.y = 0.03;
      this.link.geometry.setFromPoints([a, b]);
      this.link.computeLineDistances();
    }

    // --- motes drift up, slowly
    const mp = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < mp.count; i++) {
      let y = mp.getY(i) + dt * (0.05 + (i % 7) * 0.012);
      if (y > 5) y = -1;
      mp.setY(i, y);
    }
    mp.needsUpdate = true;
    (this.motes.material as THREE.PointsMaterial).opacity = 0.12 + 0.3 * u.uAlive.value;

    // --- camera
    // --- the land around the plot: a zoom level of this same scene, not another page
    const regionOn = st.stage === 'live' && st.regionOn && (st.view === 'field' || st.view === 'network');
    this.region.setRegion(st.regionData?.region ?? null, W, Lz);
    this.region.setMatches(st.regionData?.matches ?? []);
    this.region.update(dt, regionOn, st.selectedFarm, st.hoverFarm);
    this.probeGroup.visible = this.region.amount < 0.5;

    const mode: CamMode = st.stage === 'welcome' ? 'welcome' : building ? 'build' : st.stage !== 'live' ? 'far' : regionOn ? 'region' : st.view === 'pour' ? 'pour' : 'live';
    const farmAt = mode === 'region' && st.selectedFarm ? this.region.fieldPos(st.selectedFarm) : null;
    const poseKey = mode + (farmAt ? ':' + st.selectedFarm : '');
    if (poseKey !== this.poseKey) {
      const zoomLevelChanged = (mode === 'region') !== (this.camMode === 'region');
      this.poseKey = poseKey; this.camMode = mode; this.camAnimating = true; this.userMoved = false;
      if (zoomLevelChanged) this.camLockUntil = now + 1500;
      // gliding to a farm keeps the user's viewing angle; only the target and the height change
      this.pose = farmAt ? { dir: CAM.region.dir, dist: FARM_DIST, target: [farmAt.x, GROUND, farmAt.z] } : CAM[mode];
    }
    const locked = now < this.camLockUntil;
    this.controls.enableZoom = !locked;
    this.controls.minDistance = this.camAnimating ? 4 : mode === 'region' ? 26 : 5;
    this.controls.maxDistance = this.camAnimating ? 200 : mode === 'region' ? 150 : st.stage === 'live' && st.view === 'field' && st.regionData?.region ? 26 : 22;
    if (this.camAnimating) {
      this.applyCam(this.pose, this.reducedMotion.matches ? 1 : 1 - Math.exp(-(mode === 'region' ? 1.9 : 2.4) * dt));
      const want = new THREE.Vector3(...this.pose.dir).normalize().multiplyScalar(this.pose.dist).add(new THREE.Vector3(...this.pose.target));
      if (this.camera.aspect >= 1 && this.camera.position.distanceTo(want) < 0.02 * Math.max(1, this.pose.dist / 10)) this.camAnimating = false;
    } else if (!locked && st.stage === 'live') {
      // scrolling IS the control: out past the plot lifts the camera over the region, back in brings it home
      const d = this.camera.position.distanceTo(this.controls.target);
      if (mode === 'live' && st.regionData?.region && d > ZOOM_OUT_AT) st.goRegion(true);
      else if (mode === 'region' && d < ZOOM_IN_AT) st.goRegion(false);
    }
    // Slide the picture (not the orbit) so the slab sits in the part of the
    // screen that panels are not covering.
    const wide = this.camera.aspect > 1.15;
    const wantX = !wide ? 0 : mode === 'welcome' ? 0.19 : mode === 'build' || mode === 'far' ? 0.13 : mode === 'region' ? -0.09 : st.drawer || st.demoOpen ? -0.09 : 0.02;
    const wantY = !wide ? (st.stage === 'live' ? 0.12 : 0.16) : mode === 'region' ? (st.selectedFarm ? 0.14 : 0.06) : mode === 'live' || mode === 'pour' ? 0.07 : 0;
    this.shiftX = damp(this.shiftX, wantX, 3, dt);
    this.shiftY = damp(this.shiftY, wantY, 3, dt);
    const cw = this.canvas.clientWidth || 1, ch = this.canvas.clientHeight || 1;
    this.camera.setViewOffset(cw, ch, -this.shiftX * cw, this.shiftY * ch, cw, ch);

    // a slow idle drift keeps the scene alive when nobody is touching it
    this.controls.autoRotate = !this.reducedMotion.matches && !this.userMoved && (mode === 'welcome' || mode === 'live' || (mode === 'region' && !st.selectedFarm)) && !this.camAnimating;
    this.controls.autoRotateSpeed = mode === 'welcome' ? 0.7 : mode === 'region' ? 0.1 : 0.18;
  }
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
