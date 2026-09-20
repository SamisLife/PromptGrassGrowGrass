/**
 * GLSL for the field.
 *
 * One shared chunk (`FIELD`) defines how moisture and temperature vary across
 * the plot. The soil surface, the slab's cut sides and the sprouts all call
 * the same functions, so they always agree with each other.
 *
 * World space: the plot is centred on the origin, top surface at y = 0,
 * x = plot width, z = plot length.
 */

export const MAX_ZONES = 4;

export const FIELD = /* glsl */ `
#define MAX_ZONES ${MAX_ZONES}
uniform float uTime;
uniform int uZoneCount;
uniform vec2 uZonePos[MAX_ZONES];
uniform float uZoneKnown[MAX_ZONES];
uniform vec3 cSoilUnknown;
uniform float uZoneMoist[MAX_ZONES];   // 0..1, already smoothed on the CPU
uniform float uZoneTemp[MAX_ZONES];    // 0..1 cold..warm, -1 when unknown
uniform float uZoneGlow[MAX_ZONES];    // 1 -> 0 after an agent call
uniform vec3 uPour;                    // xy = source (world xz), z = front radius
uniform float uPourActive;             // 0..1
uniform float uPourWet;

// smoothstep with reversed edges is undefined in GLSL; this version is defined
// for either order, so "1 -> 0" ramps are safe on every GPU.
float sstep(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0., 1.); return t*t*(3. - 2.*t); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= .5; } return s; }

// Wetting front: a noisy, fingered edge, so it reads as water finding its way
// through earth and not as a circle being drawn.
float pourFront(vec2 p){
  float d = distance(p, uPour.xy);
  float n = fbm(p*1.7 + 11.) * .62 + vnoise(p*7.) * .22 + vnoise(p*19.) * .08;
  float edge = uPour.z * (.72 + .56*n);
  float soft = .08 + .30 * min(1., uPour.z);
  return 1. - sstep(edge - soft, edge + .03, d);
}

// Unknown is a separate visual state, never a fabricated dry reading.
float fieldKnown(vec2 p){
  float nearest = 1e9, known = 0.;
  for(int i=0;i<MAX_ZONES;i++){
    if(i >= uZoneCount) break;
    float d = distance(p, uZonePos[i]);
    if(d < nearest){ nearest = d; known = uZoneKnown[i]; }
  }
  return known;
}

// Settled moisture from the probes only (no pour front). Sprouts follow this:
// plants answer to soil that has been moist for a while, not to a passing front.
float fieldMoistureBase(vec2 p){
  vec2 q = p + .45 * (vec2(fbm(p*.9 + 3.1), fbm(p*.9 + 9.7)) - .5);
  float ws = 0., acc = 0.;
  for(int i=0;i<MAX_ZONES;i++){
    if(i >= uZoneCount) break;
    float d = distance(q, uZonePos[i]);
    float w = 1. / (d*d*d + .015);
    ws += w; acc += w * uZoneMoist[i];
  }
  float m = acc / max(ws, 1e-4);
  m *= 1. + (fbm(p*2.3 + uTime*.02) - .5) * .22;          // slow drift: the field breathes
  return clamp(m, 0., 1.);
}

float pourInside(vec2 p){
  float d = distance(p, uPour.xy);
  float n = fbm(p*1.7 + 11.) * .62 + vnoise(p*7.) * .22 + vnoise(p*19.) * .08;
  float edge = uPour.z * (.72 + .56*n);
  return clamp((edge - d) / max(edge, .001), 0., 1.);
}

float fieldMoisture(vec2 p){
  float m = fieldMoistureBase(p);
  if(uPourActive > 0.) m = max(m, pourFront(p) * uPourWet * uPourActive);
  return clamp(m, 0., 1.);
}

// returns -1 when no zone knows its temperature
float fieldTemp(vec2 p){
  float ws = 0., acc = 0.;
  for(int i=0;i<MAX_ZONES;i++){
    if(i >= uZoneCount) break;
    if(uZoneTemp[i] < 0.) continue;
    float d = distance(p, uZonePos[i]);
    float w = 1. / (d*d + .05);
    ws += w; acc += w * uZoneTemp[i];
  }
  return ws > 0. ? acc/ws : -1.;
}

// x = index of nearest zone, y = distance to it, z = (d2 - d1): 0 on a boundary
vec3 nearestZone(vec2 p){
  float d1 = 1e9, d2 = 1e9; float idx = 0.;
  for(int i=0;i<MAX_ZONES;i++){
    if(i >= uZoneCount) break;
    float d = distance(p, uZonePos[i]);
    if(d < d1){ d2 = d1; d1 = d; idx = float(i); } else if(d < d2){ d2 = d; }
  }
  return vec3(idx, d1, d2 - d1);
}
`;

export const SLAB_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SLAB_FRAG = /* glsl */ `
${FIELD}
varying vec3 vWorld;
varying vec3 vN;
uniform vec2 uPlotSize;      // world units (x, z)
uniform float uThickness;
uniform float uBlueprint;    // 1 = build mode
uniform float uAlive;        // 0 = dormant, 1 = fully alive
uniform float uGrid;         // blueprint grid pitch, world units
uniform float uLens;         // 0 natural, 1 moisture, 2 temperature
uniform float uSelected;     // zone index or -1
uniform float uScan;         // diagnose sweep 0..1, <0 off
uniform float uPourAge;      // seconds since water hit the source, <0 off
uniform vec3 cSoilDry, cSoilWet, cSoilSub, cSoilDeep, cWater, cWarm, cCool, cAgent, cBlueprint, cBlueprintLine, cAccent;

const vec3 L = normalize(vec3(.45, .85, .35));

float gridLines(vec2 p, float pitch){
  vec2 g = abs(fract(p / pitch - .5) - .5) / fwidth(p / pitch);
  return 1. - min(min(g.x, g.y), 1.);
}

float cracks(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x), float(y)); vec2 o = hash22(i+g);
    float d = length(g + o - f);
    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2){ d2 = d; }
  }
  return d2 - d1;
}

vec3 bumpNormal(vec3 N, float h, float scale){
  vec3 sx = dFdx(vWorld), sy = dFdy(vWorld);
  vec3 r1 = cross(sy, N), r2 = cross(N, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - scale * grad);
}

vec3 moistureRamp(float m){
  vec3 a = vec3(.62,.50,.36), b = vec3(.30,.55,.45), c = vec3(.10,.42,.85);
  return m < .5 ? mix(a, b, m*2.) : mix(b, c, (m-.5)*2.);
}

void main(){
  vec2 p = vWorld.xz;
  vec3 V = normalize(cameraPosition - vWorld);
  bool top = vN.y > .5;
  // side walls sample a little inside the slab, so they read as a cross-section
  vec2 pm = top ? p : p - vN.xz * min(uPlotSize.x, uPlotSize.y) * .3;
  float m = fieldMoisture(pm);
  float tN = fieldTemp(p);
  vec3 zn = nearestZone(p);
  vec3 col;
  // screen-space derivatives must be taken outside data-dependent branches
  float gMinor = gridLines(p, uGrid), gMajor = gridLines(p, uGrid*5.), gScan = gridLines(p, .25);

  if(top){
    // clods (low), crumbs (mid), a little grit (high). Kept soft so it reads
    // as earth at any zoom and never as static.
    float g1 = fbm(p*2.6), g2 = fbm(p*5. + 4.), g3 = vnoise(p*17.);
    float grain = g1*.58 + g2*.36 + g3*.06;
    float wetness = sstep(.06, .82, m);
    float vitality = sstep(.14, .42, m) * uAlive;

    vec3 dry = cSoilDry * (.80 + .40*grain);
    vec3 wet = cSoilWet * (.70 + .65*grain);
    col = mix(dry, wet, wetness);

    // parched soil cracks; the cracks close as it wets
    float ck = cracks(p*2.4 + fbm(p*1.3)*.6);
    float crackMask = (1. - sstep(.0, .07, ck)) * (1. - sstep(.12, .38, m));
    col *= 1. - .6*crackMask;

    // dull and still when it needs attention, richer when healthy
    float lum = dot(col, vec3(.3,.59,.11));
    col = mix(mix(vec3(lum), col, .62) * .9, col * (1. + .05*sin(uTime*.9 + g1*9.)), vitality);

    vec3 N = bumpNormal(vec3(0,1,0), g1*.8 + g2*.2 - crackMask*.5, mix(.9, .22, wetness));

    // standing water near the pour, with ripples
    float pool = 0.;
    if(uPourActive > 0.){
      float d = distance(p, uPour.xy);
      pool = sstep(.55, .0, d / max(.35, uPour.z*.45)) * uPourActive * sstep(8., 0., max(uPourAge, 0.) - 6.);
      float rip = sin(d*34. - uTime*7.) * .5 + .5;
      N = normalize(mix(N, vec3(0,1,0) + vec3(rip-.5, 0., rip-.5)*.18, pool*.85));
      // the leading edge of the front: darker, glistening
      float e = pourFront(p);
      float lead = sstep(.02,.35,e) * (1. - sstep(.35,.9,e));
      col = mix(col, cSoilWet*.55, lead*.5*uPourActive);
      col = mix(col, cWater*.55 + col*.4, pool*.55);
      // splash rings in the first seconds
      if(uPourAge >= 0. && uPourAge < 4.){
        float rr = uPourAge*.55;
        float ring = sstep(.07, 0., abs(d - rr)) + sstep(.05, 0., abs(d - rr*.55));
        col += cWater * ring * .35 * (1. - uPourAge/4.);
      }
    }

    float diff = max(dot(N, L), 0.);
    vec3 H = normalize(L + V);
    // the wet sheen uses only the broad shape of the ground: fine grit in a
    // specular term turns into glitter
    vec3 Ns = normalize(mix(bumpNormal(vec3(0,1,0), g1, .22), N, pool));
    float spec = min(pow(max(dot(Ns, H), 0.), mix(10., 40., wetness)) * mix(.02, .14, sstep(.35, .95, m)), .09) + pow(max(dot(Ns, H), 0.), 90.) * pool * .8;
    float rim = pow(1. - max(dot(N, V), 0.), 3.);
    col = col * (.34 + .86*diff) + vec3(.85,.93,1.) * spec + col * rim * .25;

    // temperature: a faint wash normally, the whole story in the temperature lens
    if(tN >= 0.){
      vec3 tcol = mix(cCool, cWarm, sstep(.15,.85,tN));
      col += tcol * (.035 + .02*sin(uTime*.6 + p.x)) * uAlive;
      if(uLens > 1.5) col = mix(col, tcol * (.55 + .5*grain), .78);
    } else if(uLens > 1.5) col = mix(col, vec3(.25), .7);
    if(uLens > .5 && uLens < 1.5){
      vec3 r = moistureRamp(m) * (.6 + .5*grain);
      float iso = 1. - sstep(0., .04, abs(fract(m*8.) - .5) - .46);
      col = mix(col, r, .82) + iso*.06;
    }

    // Unknown moisture has a neutral surface, not a fabricated drought.
    // Keep the labelled pour estimate and temperature-only lens independent.
    float unknown = (1. - fieldKnown(pm)) * (1. - uBlueprint) * (1. - uPourActive);
    vec3 neutral = cSoilUnknown * (.65 + .3 * grain);
    if(uLens > .5 && uLens < 1.5) neutral = vec3(dot(neutral, vec3(.3,.59,.11)));
    if(uLens > 1.5 && tN >= 0.) unknown = 0.;
    col = mix(col, neutral, unknown);

    // zone boundaries and selection
    float edge = 1. - sstep(0., .03, zn.z);
    col += vec3(.9,1.,.9) * edge * (.10 + .25*uBlueprint) * step(1.5, float(uZoneCount));
    if(uSelected >= 0. && abs(zn.x - uSelected) < .5) col *= 1.07;

    // the agent touching a zone: a violet ring sweeps out from the probe
    for(int i=0;i<MAX_ZONES;i++){
      if(i >= uZoneCount) break;
      float g = uZoneGlow[i]; if(g <= 0.) continue;
      float d = distance(p, uZonePos[i]);
      float r = (1. - g) * 5.;
      float ring = sstep(.22, 0., abs(d - r)) + .5*sstep(.12, 0., abs(d - r*.6));
      float region = abs(zn.x - float(i)) < .5 ? 1. : 0.;
      col += cAgent * (ring * 1.3 * g * region + region * g * g * .32);
    }

    // diagnose: a sweep of light across the plot
    if(uScan >= 0.){
      float sx = mix(-uPlotSize.x*.5 - .4, uPlotSize.x*.5 + .4, uScan);
      float band = sstep(.5, 0., abs(p.x - sx));
      float trail = sstep(1.8, 0., sx - p.x) * step(p.x, sx);
      col += cAccent * (band*.55 + trail*.10*gScan);
    }

    // blueprint (build mode) dissolves into soil
    float bpMask = sstep(-.15, .15, uBlueprint*1.3 - .15 - fbm(p*1.2));
    if(bpMask > 0.){
      float minor = gMinor, major = gMajor;
      vec2 b = abs(p) - uPlotSize*.5; float border = sstep(.06, .0, -max(b.x, b.y));
      vec3 bp = cBlueprint * (.85 + .3*grain) + cBlueprintLine * (minor*.13 + major*.32 + border*.55);
      bp += cBlueprintLine * edge * .35;
      col = mix(col, bp, bpMask);
    }
  } else {
    // the cut side: strata, and water seeping down under wet ground
    float depth = clamp(-vWorld.y / uThickness, 0., 1.);
    float along = abs(vN.x) > .5 ? vWorld.z : vWorld.x;
    vec2 sp = vec2(along, vWorld.y);
    float warp = (fbm(vec2(along*1.4, 3.)) - .5) * .16;
    float d = depth + warp;
    float grain = fbm(sp*5.)*.7 + fbm(sp*14.)*.3;

    vec3 topsoil = mix(cSoilDry, cSoilWet, .35) * (.7 + .5*grain);
    vec3 sub = cSoilSub * (.75 + .45*grain);
    vec3 deep = cSoilDeep * (.7 + .5*grain);
    col = mix(topsoil, sub, sstep(.26, .40, d));
    col = mix(col, deep, sstep(.62, .80, d));

    // pebbles in the lower horizons
    // scattered stones: irregular size and shape, sparse, only in the lower horizons
    vec2 ps = sp*vec2(5.5, 6.5) + fbm(sp*2.)*1.5;
    vec2 cell = floor(ps); vec2 o = hash22(cell);
    vec2 dv = (fract(ps) - .2 - o*.6) * vec2(1., 1.3 + o.x);
    float rad = .07 + .16*hash12(cell+9.);
    float peb = sstep(rad, rad*.6, length(dv)) * step(.72, hash12(cell+4.)) * sstep(.3,.55,d);
    col = mix(col, mix(cSoilSub, vec3(.46,.43,.40), .7)*(.65+.5*o.y), peb*.85);

    // seepage in cross-section. Settled moisture has soaked deep; behind a fresh
    // front the water has only gone as deep as it has had time to, so the
    // profile curves: deep at the source, shallow at the leading edge.
    float wob = (vnoise(sp*5.) - .5) * .18;
    float mB = fieldMoistureBase(pm);
    float seepB = .12 + .80*sstep(.2, .95, mB);
    float wetSide = (1. - sstep(seepB - .12, seepB + .10, d + wob)) * sstep(.12, .5, mB);
    if(uPourActive > 0.){
      float inside = pourInside(pm);
      float seepP = .95 * sqrt(inside);
      wetSide = max(wetSide, (1. - sstep(seepP - .10, seepP + .06, d + wob)) * step(.001, inside) * uPourActive);
    }
    col = mix(col, col*.5 + cSoilWet*.32, wetSide);

    float diff = max(dot(vN, L), 0.);
    col *= .42 + .75*diff;
    col *= mix(1., .30, sstep(.55, 1., depth));
    col *= .75 + .25*sstep(0., .06, depth);           // lip shadow under the surface

    float bp = uBlueprint;
    if(bp > 0.){
      vec3 b = cBlueprint*.7 + cBlueprintLine * (gridLines(sp, uGrid)*.10 + sstep(.03,0.,depth)*.5);
      col = mix(col, b, bp);
    }
    float lumS = dot(col, vec3(.3,.59,.11));
    col = mix(mix(vec3(lumS), col, .5)*.9, col, max(uAlive, bp));
  }

  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SPROUT_VERT = /* glsl */ `
${FIELD}
attribute vec2 aOffset;   // -0.5..0.5 across the plot
attribute vec3 aRand;
uniform vec2 uPlotSize;
uniform float uAlive;
uniform float uBlueprint;
varying float vH;
varying float vVigor;
varying float vShade;

void main(){
  vec2 base = aOffset * (uPlotSize - .12);
  float m = fieldMoistureBase(base);
  // healthy band: enough water, not drowning
  float vigor = sstep(.22, .48, m) * (1. - .55*sstep(.80, .97, m));
  float grow = uAlive * (1. - uBlueprint) * fieldKnown(base);
  float stubble = .16;
  float h = (.05 + .15*aRand.x) * mix(stubble, 1., vigor) * grow;

  vec3 pos = position;
  vH = pos.y;
  float width = (1. - pos.y*.85) * (.6 + .8*aRand.z);
  float ca = cos(aRand.y*6.283), sa = sin(aRand.y*6.283);
  vec2 dir = vec2(ca, sa);
  // still when it needs attention, swaying when alive
  float sway = (sin(uTime*1.7 + base.x*2.1 + aRand.y*6.) + .5*sin(uTime*2.9 + base.y*3.3)) * .09 * vigor;
  float droop = (1. - vigor) * .10;
  float bend = pos.y*pos.y;
  vec3 w = vec3(base.x, 0., base.y);
  w.xz += dir * pos.x * width;
  w.y += pos.y * h * (1. - droop*bend*2.);
  w.xz += vec2(sa, -ca) * (sway + droop) * bend * h * 3.;
  vVigor = vigor;
  vShade = .75 + .5*aRand.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}
`;

export const SPROUT_FRAG = /* glsl */ `
uniform vec3 cAlive, cDead;
varying float vH;
varying float vVigor;
varying float vShade;
void main(){
  vec3 col = mix(cDead*.62, cAlive, vVigor) * vShade;
  col *= .45 + .85*vH;
  col += vec3(.25,.35,.05) * vVigor * pow(vH, 3.);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
