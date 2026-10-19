import * as THREE from 'three';

/**
 * Night and day over Tenochtitlan. Every light lives in the scene from the
 * start and only its intensity moves, so changing the hour never recompiles
 * a shader. `set(k)` blends everything: 0 is the night plaza, 1 a clear
 * highland afternoon with the volcanoes standing on the horizon.
 */

const NIGHT_HORIZON = new THREE.Color('#100d0b');
const DAY_HORIZON = new THREE.Color('#e3c9a0'); // late-afternoon haze, warm

/** A dome: night haze and stars, or a deep sky with sun and haze; volcano silhouettes in both. */
function dome() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(300, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uDay: { value: 0 },
        uSun: { value: new THREE.Vector3(10, 5.6, 7).normalize() },
        uNightHorizon: { value: NIGHT_HORIZON.clone() },
        uDayHorizon: { value: DAY_HORIZON.clone() },
        uNightZenith: { value: new THREE.Color(0.006, 0.006, 0.007) },
        uSkyline: { value: 1 },
        uMoon: { value: new THREE.Vector3(-0.35, 0.55, -0.76).normalize() },
        uMoonOn: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uDay, uSkyline, uMoonOn;
        uniform vec3 uSun, uNightHorizon, uDayHorizon, uNightZenith, uMoon;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(float x) { float i = floor(x), f = fract(x); return mix(hash(vec2(i, 1.7)), hash(vec2(i + 1.0, 1.7)), f * f * (3.0 - 2.0 * f)); }
        float ridge(float a) { return noise(a * 9.0) * 0.6 + noise(a * 27.0) * 0.28 + noise(a * 80.0) * 0.12; }
        // Elevation of the skyline at azimuth a (0 = straight past the Templo Mayor).
        float skyline(float a) {
          float h = 0.006 + 0.016 * ridge(a + 3.0);
          float popo = 0.078 * pow(max(0.0, 1.0 - abs(a - 0.3) / 0.13), 1.25);          // Popocatépetl: a clean cone
          float izta = 0.052 * smoothstep(-0.47, -0.4, a) * smoothstep(-0.13, -0.2, a)    // Iztaccíhuatl: the long sleeping ridge
                     * (0.8 + 0.2 * sin((a + 0.47) * 22.0)) ;
          return max(h, max(popo, izta)) + 0.004 * ridge(a * 3.0);
        }
        void main() {
          vec3 d = normalize(vDir);
          float a = atan(d.x, -d.z);
          // Night: warm haze at the horizon going black overhead, faint stars.
          vec3 night = mix(uNightHorizon, uNightZenith, smoothstep(-0.02, 0.45, d.y));
          vec2 g = vec2(a * 140.0, d.y * 140.0);
          vec2 cell = floor(g);
          vec2 at = vec2(hash(cell), hash(cell + 7.3));
          float star = step(0.986, hash(cell + 3.1)) * smoothstep(0.32, 0.0, length(fract(g) - at));
          night += vec3(0.75, 0.72, 0.66) * star * smoothstep(0.08, 0.4, d.y) * (0.35 + 0.65 * hash(cell + 9.1));
          // Day: a deep high-altitude blue over a pale haze, the sun and its halo.
          vec3 day = mix(uDayHorizon, vec3(0.06, 0.2, 0.46), pow(smoothstep(-0.01, 0.55, d.y), 0.5));
          day = mix(day, vec3(1.0, 0.72, 0.42), pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.35, d.y)) * 0.45);
          float s = max(dot(d, uSun), 0.0);
          day += vec3(1.0, 0.82, 0.58) * (pow(s, 6.0) * 0.22 + pow(s, 900.0) * 30.0);
          // The moon over the forest: a small hard disc and a wide pale halo.
          float mo = max(dot(d, uMoon), 0.0);
          night += uMoonOn * (vec3(0.9, 0.93, 1.0) * smoothstep(0.99955, 0.9997, mo) * 3.0 + vec3(0.12, 0.16, 0.24) * pow(mo, 24.0) * 0.6);
          vec3 c = mix(night, day, uDay);
          // The volcanoes: blue with distance by day, a shade above the sky by night, snow on the high ground.
          float h = skyline(a) * uSkyline - (1.0 - uSkyline) * 0.05;
          if (d.y < h && d.y > -0.05) {
            float up = (d.y + 0.01) / max(h, 0.001);
            vec3 rock = mix(mix(uDayHorizon, vec3(0.27, 0.31, 0.4), 0.72), uDayHorizon, 0.3 * (1.0 - up));
            float snow = smoothstep(0.05, 0.062, d.y) * step(0.045, h) * (0.75 + 0.25 * noise(a * 300.0));
            rock = mix(rock, vec3(0.86, 0.88, 0.92), snow * 0.85);
            vec3 nightRock = uNightHorizon * 0.55 + vec3(0.004);
            c = mix(nightRock, rock, uDay);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

/**
 * What the stone reflects. Night: near-black with a few light cards (braziers,
 * a strip of sky, a rim). Day: the sky's blue all round, the sun, warm ground bounce.
 */
function lightformers(day: boolean) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(day ? '#5d7290' : '#030303');
  const card = (color: string, intensity: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  if (day) {
    card('#ffdcae', 14, 1.4, 1.4, 4.6, 2.6, 3.2); // sun, low and warm
    card('#a3b9d8', 1.6, 12, 4, 0, 7, 0);       // open sky overhead
    card('#8a7558', 1.1, 14, 3, 0, -4, 0);      // sunlit plaza bouncing back
  } else {
    card('#ff9447', 7, 1.2, 1.6, -4, 1.2, 2.6);
    card('#ff8236', 3, 1.0, 1.2, 4.6, 0.8, -2.2);
    card('#efe6da', 0.9, 7, 1.2, 0, 6, 0);
    card('#f3ece4', 2.2, 3.2, 0.5, 2.2, 2.4, -5);
  }
  return env;
}

/** What changes between the two places; the hour blends within each. */
export type Place = 'tenochtitlan' | 'calakmul';
const PLACES = {
  tenochtitlan: {
    skyline: 1, moon: 0, nightHorizon: '#100d0b', nightZenith: '#020202', dayHorizon: '#e3c9a0', moonlight: 0, flood: 1,
    fog: { night: [16, 72], day: [45, 210] },
  },
  // Humid air: a paler, cooler haze by day; by night a deep blue sky, a moon, and its light on the trees.
  calakmul: {
    skyline: 0, moon: 1, nightHorizon: '#141c28', nightZenith: '#02040a', dayHorizon: '#c3cfd2', moonlight: 0.75, flood: 0,
    fog: { night: [30, 420], day: [130, 900] },
  },
} as const;

export function createAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer, monumentZ: number) {
  const sky = dome();
  scene.add(sky);
  const fog = new THREE.Fog(NIGHT_HORIZON.clone(), 16, 72);
  scene.fog = fog;
  scene.background = NIGHT_HORIZON.clone();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = { night: pmrem.fromScene(lightformers(false), 0.02).texture, day: pmrem.fromScene(lightformers(true), 0.02).texture };
  scene.environment = env.night;

  // Night key: a stage pool on the board.
  const key = new THREE.SpotLight('#fff0dc', 420, 0, 0.56, 0.6, 2);
  key.position.set(-3.2, 13, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  // Day key: the sun from the side, low enough in the afternoon to rake the carving
  // of both armies and the temple's stairs.
  const sun = new THREE.DirectionalLight('#ffdcb0', 0);
  sun.position.set(10, 5.6, 7); // ≈27° up: the golden hour, long shadows across the board
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -11; // the whole summit deck in Calakmul
  sc.right = sc.top = 11;
  sc.near = 1;
  sc.far = 40;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2;
  const hemi = new THREE.HemisphereLight('#8fb0d8', '#8a6a4a', 0);
  const rim = new THREE.DirectionalLight('#c4cee2', 1.8);
  rim.position.set(3, 9, -12);
  const fill = new THREE.DirectionalLight('#ffe6cc', 0.55); // from the player's seat, so faces never go to mud
  fill.position.set(2, 6, 12);
  const flood = new THREE.SpotLight('#ffb878', 1100, 0, 0.38, 0.9, 2); // the monument, floodlit from the plaza
  flood.position.set(0, 0.3, -11);
  flood.target.position.set(0, 5, monumentZ);
  scene.add(key, key.target, sun, sun.target, hemi, rim, fill, flood, flood.target);
  // Both shadow maps must exist from the first pass, even the one for the dark light.
  key.shadow.needsUpdate = sun.shadow.needsUpdate = true;

  const mix = (a: number, b: number, k: number) => a + (b - a) * k;
  let place: Place = 'tenochtitlan';
  const nightHorizon = NIGHT_HORIZON.clone();
  const dayHorizon = DAY_HORIZON.clone();
  const SUN = new THREE.Color('#ffdcb0');
  const MOON = new THREE.Color('#9fb6dc');
  const SUN_AT = new THREE.Vector3(10, 5.6, 7);
  const MOON_AT = (sky.material as THREE.ShaderMaterial).uniforms.uMoon.value.clone().multiplyScalar(16); // light comes from the moon you see
  // `ground` is the plaza's normal strength: a floor scan raked by a low sun reads as cracked mud at full depth.
  const state = { k: 0, exposure: 1.22, bloom: 0.42, fire: 1, ground: 1.2, plaza: new THREE.Color('#857a6e'), dust: new THREE.Color('#6a5848') };
  // By day the plaza reads as sunlit limestone, by night as dark worn stone under fire.
  const PLAZA = { night: new THREE.Color('#857a6e'), day: new THREE.Color('#c9b9a0') };
  const DUST = { night: new THREE.Color('#6a5848'), day: new THREE.Color('#cdb594') };

  function set(k: number) {
    state.k = k;
    const u = (sky.material as THREE.ShaderMaterial).uniforms;
    u.uDay.value = k;
    const P = PLACES[place];
    u.uSkyline.value = P.skyline;
    u.uMoonOn.value = P.moon;
    u.uNightHorizon.value.copy(nightHorizon.set(P.nightHorizon));
    u.uDayHorizon.value.copy(dayHorizon.set(P.dayHorizon));
    u.uNightZenith.value.set(P.nightZenith);
    const horizon = nightHorizon.clone().lerp(dayHorizon, k);
    fog.color.copy(horizon);
    (scene.background as THREE.Color).copy(horizon);
    fog.near = mix(P.fog.night[0], P.fog.day[0], k);
    fog.far = mix(P.fog.night[1], P.fog.day[1], k);
    scene.environment = k < 0.5 ? env.night : env.day;
    scene.environmentIntensity = k < 0.5 ? mix(0.9, 0.45, k * 2) : mix(0.45, 0.55, k * 2 - 1);
    key.intensity = 420 * (1 - k);
    // A dark light's shadow map isn't worth re-rendering.
    key.shadow.autoUpdate = k < 1;
    // By day the sun; at night in the forest, the same light turns to moonlight.
    sun.intensity = 4.8 * k + P.moonlight * (1 - k);
    sun.color.copy(MOON).lerp(SUN, k);
    sun.position.copy(P.moonlight ? MOON_AT : SUN_AT).lerp(SUN_AT, k);
    sun.shadow.autoUpdate = sun.intensity > 0;
    hemi.intensity = 0.55 * k;
    rim.intensity = mix(1.8, 0.5, k);
    fill.intensity = mix(0.55, 0.25, k);
    flood.intensity = 1100 * (1 - k) ** 2 * P.flood;
    state.exposure = mix(1.22, 0.95, k);
    state.ground = mix(1.2, 0.8, k);
    state.bloom = mix(0.42, 0.18, k);
    state.fire = mix(1, 0.08, k);
    state.dust.copy(DUST.night).lerp(DUST.day, k);
    state.plaza.copy(PLAZA.night).lerp(PLAZA.day, k);
  }
  set(0);

  return {
    state,
    set,
    get place() { return place; },
    setPlace(p: Place) { place = p; set(state.k); },
    dispose() { pmrem.dispose(); env.night.dispose(); env.day.dispose(); },
  };
}

export type Atmosphere = ReturnType<typeof createAtmosphere>;
