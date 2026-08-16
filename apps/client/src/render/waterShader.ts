import * as THREE from 'three';

/**
 * Matériau d'eau animée.
 *
 * L'onde est calculée dans le vertex shader à partir des coordonnées **monde** : deux
 * chunks voisins partagent leurs sommets de rive, donc une onde exprimée en coordonnées
 * locales se casserait aux frontières. La normale perturbée est dérivée analytiquement de
 * la fonction d'onde, ce qui éclaire l'eau sans aucune géométrie recalculée côté CPU.
 *
 * Le registre d'animation est un état visuel global, partagé par tous les chunks : chaque
 * frame, `updateWaterFrame` pousse le temps, la direction du soleil et le brouillard de la
 * scène dans tous les matériaux actifs.
 */

const WAVE_HEIGHT_M = 0.09;
const OPACITY = 0.78;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uTime;
  uniform vec2 uOrigin;
  uniform float uWaveHeight;
  uniform float uFlowSpeed;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vDepth;
  attribute float aDepth;

  void main() {
    float wx = position.x + uOrigin.x;
    float wz = position.z + uOrigin.y;

    float time = uTime * mix(0.35, 1.15, uFlowSpeed);
    float wave = (sin(wx * 0.55 + time * 0.9) + cos(wz * 0.45 + time * 0.7)) * 0.5;
    vec3 displaced = vec3(position.x, position.y + wave * uWaveHeight, position.z);

    // Normale de la surface ondulée : dérivées analytiques de l'onde.
    float dwx = cos(wx * 0.55 + time * 0.9) * 0.5 * 0.55 * uWaveHeight;
    float dwz = -sin(wz * 0.45 + time * 0.7) * 0.5 * 0.45 * uWaveHeight;

    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize((modelMatrix * vec4(normalize(vec3(-dwx, 1.0, -dwz)), 0.0)).xyz);
    vDepth = aDepth;
    gl_Position = projectionMatrix * viewMatrix * world;

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uSunDir;
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  uniform float uFlowSpeed;
  uniform float uRain;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vDepth;

  void main() {
    #include <logdepthbuf_fragment>

    float diffuse = max(dot(vNormal, uSunDir), 0.0);
    float depthBlend = smoothstep(0.05, 2.8, vDepth);
    vec3 depthColor = mix(uShallowColor, uDeepColor, depthBlend);

    // Liseré d'écume stylisé : bande blanche nette juste au bord, qui s'estompe vite
    // vers la couleur d'eau peu profonde — plus la « coupure » nette d'un maillage
    // clippé à vif, une transition dessinée à la place.
    float foamEdge = 1.0 - smoothstep(0.0, 0.45, vDepth);
    float foamCore = 1.0 - smoothstep(0.0, 0.12, vDepth);
    // Sur un cours rapide, une bande blanche sur chaque triangle de rive révélait la
    // tessellation du terrain vue de loin. Les eaux stagnantes gardent leur écume nette,
    // tandis qu'une rivière privilégie un reflet continu dans le sens du ruban.
    float foamStrength = mix(1.0, 0.28, uFlowSpeed);
    vec3 foamColor = vec3(0.92, 0.97, 0.95);

    vec3 lit = depthColor * (0.45 + 0.65 * diffuse);
    float rainRing = sin(length(vWorldPos.xz * 1.7) * 5.0 - uTime * 18.0);
    lit += vec3(0.08, 0.11, 0.13) * max(0.0, rainRing) * uRain * 0.22;
    lit = mix(lit, foamColor, foamCore * 0.85 * foamStrength);
    lit += vec3(0.12, 0.16, 0.13) * foamEdge * foamStrength;

    float fogFactor = smoothstep(uFogNear, uFogFar, distance(cameraPosition, vWorldPos));
    vec3 color = mix(lit, uFogColor, fogFactor);
    gl_FragColor = vec4(color, uOpacity);
  }
`;

interface WaterUniforms extends Record<string, { value: unknown }> {
  uTime: { value: number };
  uOrigin: { value: THREE.Vector2 };
  uWaveHeight: { value: number };
  uFlowSpeed: { value: number };
  uShallowColor: { value: THREE.Color };
  uDeepColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uOpacity: { value: number };
  uRain: { value: number };
}

const active = new Set<THREE.ShaderMaterial>();
const uniformsByMaterial = new WeakMap<THREE.ShaderMaterial, WaterUniforms>();

export function createWaterMaterial(
  color: THREE.Color,
  originX: number,
  originZ: number,
  flowRenewal: number,
): THREE.ShaderMaterial {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector2(originX, originZ) },
    uWaveHeight: { value: WAVE_HEIGHT_M },
    uFlowSpeed: { value: THREE.MathUtils.clamp(flowRenewal, 0, 1) },
    uShallowColor: { value: color.clone().lerp(new THREE.Color('#8bc6bd'), 0.45) },
    uDeepColor: { value: color.clone().lerp(new THREE.Color('#163d58'), 0.58) },
    uSunDir: { value: new THREE.Vector3(0.35, 0.85, 0.4) },
    uFogColor: { value: new THREE.Color('#9fc7d8') },
    uFogNear: { value: 100 },
    uFogFar: { value: 4000 },
    uOpacity: { value: OPACITY },
    uRain: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
    // Marge de sécurité contre le z-fighting résiduel au ras du rivage (surface d'eau
    // et terrain quasi coplanaires) : pousse l'eau visuellement vers la caméra d'un
    // epsilon, sans toucher à sa position réelle ni à son ombrage.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  active.add(material);
  uniformsByMaterial.set(material, uniforms);
  return material;
}

export function disposeWaterMaterial(material: THREE.ShaderMaterial): void {
  active.delete(material);
  material.dispose();
}

export function updateWaterFrame(
  nowSeconds: number,
  sunDirection: THREE.Vector3,
  fogColor: THREE.Color,
  fogNear: number,
  fogFar: number,
  rain01: number,
): void {
  for (const material of active) {
    const uniforms = uniformsByMaterial.get(material);
    if (!uniforms) continue;
    uniforms.uTime.value = nowSeconds;
    uniforms.uSunDir.value.copy(sunDirection);
    uniforms.uFogColor.value.copy(fogColor);
    uniforms.uFogNear.value = fogNear;
    uniforms.uFogFar.value = fogFar;
    uniforms.uRain.value = THREE.MathUtils.clamp(rain01, 0, 1);
  }
}
