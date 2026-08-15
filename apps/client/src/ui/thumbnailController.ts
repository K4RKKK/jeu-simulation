import { uploadThumbnail } from '../net/worldsApi.js';

export class ThumbnailController {
  private started = false;

  constructor(
    private readonly worldName: () => string | null,
    private readonly capture: () => string | null,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    window.setTimeout(() => this.captureAndUpload(), 10_000);
    window.setInterval(() => this.captureAndUpload(), 120_000);
  }

  private captureAndUpload(): void {
    const name = this.worldName();
    const dataUrl = this.capture();
    if (name === null || dataUrl === null) return;
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (base64.length === 0) return;
    uploadThumbnail(name, base64).catch((error: unknown) => {
      console.error(`[worlds] échec de l'envoi de la miniature pour "${name}":`, error);
    });
  }
}
