import * as THREE from 'three';
import { brand } from '../brand';

/** Exaggerated bench-scale pair: 98×23 mm PCB and 6×50 mm steel probe.
 * Indicators are UI status lights, not a claim that the steel sensor has an LED.
 * All geometry is local to the draggable zone; wires route to the back rim.
 */
export function makeProbe() {
  const group = new THREE.Group();
  const c = brand.scene;
  const pcbMat = new THREE.MeshStandardMaterial({ color: c.probeBoard, roughness: .65 });
  const ink = new THREE.MeshStandardMaterial({ color: c.probeInk, roughness: .7 });
  const rubber = new THREE.MeshStandardMaterial({ color: c.probeCable, roughness: .8 });
  const steel = new THREE.MeshStandardMaterial({ color: c.probeSteel, metalness: .65, roughness: .24 });
  const pcb = new THREE.Group();
  pcb.rotation.y = -.28;
  group.add(pcb);
  const box = (parent: THREE.Group, size: number[], pos: number[], mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), mat);
    m.position.set(...pos as [number, number, number]); parent.add(m); return m;
  };
  const outline = new THREE.Shape();
  outline.moveTo(0, -.55); outline.lineTo(-.16, -.32); outline.lineTo(-.16, .78);
  outline.quadraticCurveTo(-.16, .83, -.11, .83); outline.lineTo(.11, .83);
  outline.quadraticCurveTo(.16, .83, .16, .78); outline.lineTo(.16, -.32); outline.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: .024, bevelEnabled: false, curveSegments: 3 }), pcbMat);
  blade.position.z = -.012; pcb.add(blade);
  // Printed depth mark and white outline are visible on either side of the board.
  for (const face of [-1, 1]) {
    box(pcb, [.30, .018, .002], [0, .22, face * .014], ink);
    for (const x of [-.13, .13]) box(pcb, [.006, .48, .002], [x, -.035, face * .014], ink);
  }
  box(pcb, [.085, .12, .035], [-.025, .52, .03], rubber);
  // Tin pads and discreet surface-mount components.
  for (const y of [.46, .50, .54, .58]) for (const x of [-.083, .035]) box(pcb, [.025, .013, .012], [x, y, .023], steel);
  for (const [x, y] of [[.09, .41], [.09, .59], [-.08, .68]]) {
    box(pcb, [.045, .024, .023], [x, y, .028], steel);
    box(pcb, [.025, .024, .028], [x, y, .032], rubber);
  }
  box(pcb, [.23, .095, .085], [0, .78, .049], ink);
  for (const x of [-.065, 0, .065]) box(pcb, [.026, .036, .01], [x, .79, .096], rubber);
  box(pcb, [.10, .018, .032], [0, .73, .076], ink);

  const temp = new THREE.Mesh(new THREE.CylinderGeometry(.044, .044, .73, 16), steel);
  temp.position.set(-.36, .15, .09); group.add(temp);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.048, .044, .115, 16), rubber);
  cap.position.set(-.36, .54, .09); group.add(cap);
  const led = new THREE.MeshStandardMaterial({ color: c.probeCable, emissive: brand.colors.danger });
  const tempLed = led.clone();
  const moistureLight = new THREE.Mesh(new THREE.SphereGeometry(.027, 10, 8), led);
  moistureLight.position.set(.10, .67, .036); pcb.add(moistureLight);
  const tempLight = new THREE.Mesh(new THREE.TorusGeometry(.051, .012, 6, 16), tempLed);
  tempLight.rotation.x = Math.PI / 2; tempLight.position.set(-.36, .56, .09); group.add(tempLight);

  const cables = new THREE.Group(); group.add(cables);
  const cableMats = [c.probeRed, c.probeCable, c.probeYellow, c.probeCable].map(color => new THREE.MeshStandardMaterial({ color, roughness: .75 }));
  let routeKey = '';
  const route = (backZ: number, container: boolean) => {
    // Quantise only geometry updates, never the zone's actual position. No work at rest.
    const key = `${Math.round(backZ * 25)}:${container}`;
    if (key === routeKey) return;
    routeKey = key;
    for (const child of [...cables.children]) { (child as THREE.Mesh).geometry.dispose(); cables.remove(child); }
    const edge = Math.min(-.28, backZ - .08), rim = container ? .48 : .06;
    for (let i = 0; i < 4; i++) {
      const x = i === 3 ? -.36 : (i - 1) * .055;
      const y = i === 3 ? .595 : .825;
      const points = [
        new THREE.Vector3(x, y, i === 3 ? .09 : .045),
        new THREE.Vector3(x, y + .17, -.20),
        new THREE.Vector3(x + .06, rim + .10, edge + .18),
        new THREE.Vector3(x + .08, rim, edge - .12),
        new THREE.Vector3(x + .10, -.88, edge - .24),
        new THREE.Vector3(x + .26, -.96, edge - .51),
        new THREE.Vector3(x + .57, -.96, edge - .65),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      cables.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, i === 3 ? .026 : .013, 6, false), cableMats[i]));
    }
  };
  const pts = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return new THREE.Vector2(Math.sin(t * Math.PI) * .13 * (1 - .55 * t * t), -.13 + t * .40);
  });
  const drop = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({
    color: c.water, emissive: c.water, emissiveIntensity: .45, roughness: .1, metalness: .1, transparent: true, opacity: .9,
  }));
  drop.position.x = .29;
  drop.scale.setScalar(0); group.add(drop);
  return { group, led, tempLed, drop, route };
}
