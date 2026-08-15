import * as THREE from 'three';
import type { EnvironmentSnapshot } from '@civ/shared';

const DAY_SKY = new THREE.Color('#9fc7d8');
const NIGHT_SKY = new THREE.Color('#131c26');
const DAY_LIGHT = new THREE.Color('#fff3d6');
const NIGHT_LIGHT = new THREE.Color('#5f7391');
export type WeatherPreview = 'live' | 'clear' | 'rain' | 'snow' | 'storm' | 'fog';

/**
 * Scène, lumières et boucle de rendu.
 *
 * L'ambiance suit l'environnement transmis par le serveur (élévation solaire) : le client
 * n'invente pas l'heure qu'il est, il la reçoit.
 */
export class SceneRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly precipitation: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private weather: NonNullable<EnvironmentSnapshot['weather']> | null = null;
  private weatherPreview: WeatherPreview = 'live';
  private lastRenderAt = performance.now();
  private baseSunIntensity = 1.5;
  /** Couleur de ciel courante — partagée avec le brouillard et le shader d'eau. */
  readonly skyColor = DAY_SKY.clone();
  /** Direction du soleil en espace monde, normalisée — consommée par le shader d'eau. */
  readonly sunDirection = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
  readonly fogNear: number;
  readonly fogFar: number;

  constructor(canvas: HTMLCanvasElement, worldSizeMeters: number) {
    // Le ratio far/near (voir plus bas, jusqu'à plusieurs milliers pour un grand monde)
    // épuise vite la précision d'un depth buffer standard : deux surfaces proches mais
    // distinctes (l'eau et le rivage juste en dessous, par exemple) finissent par
    // partager les mêmes valeurs de profondeur quantifiées et scintillent/se découpent
    // au rendu (« z-fighting »). Un depth buffer logarithmique répartit la précision
    // bien plus uniformément sur toute la plage de distance et élimine ce scintillement
    // sans toucher à la géométrie.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, worldSizeMeters * 3);

    this.scene.background = this.skyColor;
    this.fogNear = worldSizeMeters * 0.45;
    this.fogFar = worldSizeMeters * 1.4;
    this.scene.fog = new THREE.Fog(this.skyColor, this.fogNear, this.fogFar);

    this.hemisphere = new THREE.HemisphereLight('#cfe4ef', '#4c5a3c', 1.1);
    this.scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(DAY_LIGHT, 1.5);
    this.sun.position.set(80, 120, 40);
    this.scene.add(this.sun);

    const precipitationGeometry = new THREE.BufferGeometry();
    const precipitationPositions = new Float32Array(720 * 3);
    for (let i = 0; i < 720; i++) {
      const angle = i * 2.399963;
      const radius = 8 + ((i * 37) % 100) * 0.46;
      precipitationPositions[i * 3] = Math.cos(angle) * radius;
      precipitationPositions[i * 3 + 1] = 5 + ((i * 53) % 58);
      precipitationPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    precipitationGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(precipitationPositions, 3),
    );
    const particleCanvas = document.createElement('canvas');
    particleCanvas.width = 32;
    particleCanvas.height = 32;
    const particleContext = particleCanvas.getContext('2d');
    if (particleContext) {
      const glow = particleContext.createRadialGradient(16, 16, 1, 16, 16, 15);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.58, 'rgba(255,255,255,0.9)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      particleContext.fillStyle = glow;
      particleContext.fillRect(0, 0, 32, 32);
    }
    const precipitationMaterial = new THREE.PointsMaterial({
      color: '#b9d8ed',
      size: 0.18,
      map: new THREE.CanvasTexture(particleCanvas),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      alphaTest: 0.04,
      sizeAttenuation: true,
    });
    this.precipitation = new THREE.Points(precipitationGeometry, precipitationMaterial);
    this.precipitation.frustumCulled = false;
    this.precipitation.visible = false;
    this.scene.add(this.precipitation);

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  applyEnvironment(environment: EnvironmentSnapshot): void {
    // sunElevation ∈ [-1, 1] : on ne garde que la part diurne pour la couleur/intensité
    // (la nuit reste sombre et neutre), mais l'astre continue de décrire son arc sur
    // l'intégralité de la plage — sans ça, `daylight` clampé à 0 gèlerait sa position à
    // un point fixe pendant toute la nuit (astre « figé », rendu plat et statique).
    const daylight = Math.max(0, environment.sunElevation);
    const blend = Math.min(1, daylight * 1.6);
    const arcPhase = (environment.sunElevation + 1) * 0.5;

    this.weather = this.previewWeather(environment.weather ?? null);
    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, blend);
    const cloudCover = this.weather?.cloudCover01 ?? 0;
    this.skyColor.lerp(new THREE.Color('#52606a'), cloudCover * 0.42);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.skyColor);
      const visibility = this.weather?.visibility01 ?? 1;
      this.scene.fog.near = this.fogNear * (0.12 + visibility * 0.88);
      this.scene.fog.far = Math.max(
        this.scene.fog.near + 40,
        this.fogNear + (this.fogFar - this.fogNear) * visibility,
      );
    }

    this.sun.color.copy(NIGHT_LIGHT).lerp(DAY_LIGHT, blend);
    this.sun.intensity = 0.25 + daylight * 1.35;
    this.baseSunIntensity = this.sun.intensity;
    // Un soupçon de variation avec la hauteur de l'astre nocturne (voir `arcPhase` plus
    // bas) : la nuit profonde (astre au plus bas de son arc, vers minuit) est un peu plus
    // sombre que ses abords proches du crépuscule/de l'aube, comme un clair de lune plus
    // ou moins marqué.
    this.hemisphere.intensity = 0.35 + daylight * 0.85 + (1 - blend) * arcPhase * 0.16;
    this.hemisphere.intensity *= 1 - cloudCover * 0.28;

    const precipitation = this.weather?.precipitation01 ?? 0;
    const snowy = this.weather?.kind === 'snow';
    this.precipitation.visible =
      precipitation > 0.03 &&
      (snowy || this.weather?.kind === 'rain' || this.weather?.kind === 'storm');
    this.precipitation.material.color.set(snowy ? '#f4f7ff' : '#9bc9e6');
    this.precipitation.material.size = snowy ? 0.34 : 0.14;
    this.precipitation.material.opacity = 0.25 + precipitation * 0.7;

    // Arc est-ouest continu sur tout le cycle jour/nuit ; la hauteur suit l'élévation reçue.
    const height = -20 + arcPhase * 200;
    this.sun.position.set(Math.cos(arcPhase * Math.PI) * 140, height, 60);
    this.sunDirection.copy(this.sun.position).normalize();
  }

  render(): void {
    this.animateWeather();
    this.renderer.render(this.scene, this.camera);
  }

  private animateWeather(): void {
    const now = performance.now();
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - this.lastRenderAt) / 1000));
    this.lastRenderAt = now;
    this.sun.intensity = this.baseSunIntensity;
    if (this.precipitation.visible && this.weather) {
      this.precipitation.position.set(
        this.camera.position.x,
        this.camera.position.y - 22,
        this.camera.position.z,
      );
      const positions = this.precipitation.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const snowy = this.weather.kind === 'snow';
      const fall = (snowy ? 4 : 31) * deltaSeconds;
      const drift = this.weather.windMps * deltaSeconds * (snowy ? 0.32 : 0.12);
      for (let i = 0; i < positions.count; i++) {
        let y = positions.getY(i) - fall;
        if (y < 0) y += 62;
        positions.setXYZ(
          i,
          positions.getX(i) + drift,
          y,
          positions.getZ(i) + (snowy ? Math.sin(now * 0.001 + i) * deltaSeconds * 0.35 : 0),
        );
        if (positions.getX(i) > 55) positions.setX(i, positions.getX(i) - 110);
      }
      positions.needsUpdate = true;
    }
    if (this.weather?.kind === 'storm') {
      const cycle = now % 17000;
      const flash =
        cycle < 70
          ? 1 - cycle / 70
          : cycle >= 120 && cycle < 190
            ? 0.65 * (1 - (cycle - 120) / 70)
            : 0;
      if (flash > 0) this.sun.intensity += flash * 4.5;
    }
  }

  /** Réglable en direct (voir `GraphicsSettings.displayQuality`) — pas de recréation du renderer. */
  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  setWeatherPreview(preview: WeatherPreview): void {
    this.weatherPreview = preview;
  }

  private previewWeather(
    live: NonNullable<EnvironmentSnapshot['weather']> | null,
  ): NonNullable<EnvironmentSnapshot['weather']> | null {
    if (this.weatherPreview === 'live') return live;
    const kind = this.weatherPreview;
    return {
      region: live?.region ?? { x: 0, z: 0 },
      kind,
      precipitation01: kind === 'rain' || kind === 'snow' || kind === 'storm' ? 0.85 : 0,
      cloudCover01: kind === 'clear' ? 0.05 : kind === 'fog' ? 0.65 : 0.9,
      humidity01: kind === 'clear' ? 0.25 : 0.9,
      windMps: kind === 'storm' ? 14 : kind === 'snow' ? 4 : 7,
      visibility01: kind === 'fog' ? 0.16 : kind === 'storm' ? 0.48 : 0.82,
      temperatureDeltaC: kind === 'snow' ? -8 : 0,
      periodIndex: live?.periodIndex ?? 0,
      transition01: 1,
    };
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
