/**
 * Typed view of the update bridge the Electron preload installs.
 *
 * In the browser (`npm run dev`) there is no bridge at all, so everything here
 * is optional and the UI simply hides itself.
 */

export interface UpdateInfo {
  configured: boolean;
  appVersion: string;
  uiVersion: string;
  checkOnStartup: boolean;
}

export interface UpdateCheck {
  configured: boolean;
  available: boolean;
  /** The release needs a newer app shell, so a bundle download will not do. */
  requiresReinstall?: boolean;
  /** The repo is reachable but has not published a release yet. */
  noReleases?: boolean;
  version?: string;
  currentVersion?: string;
  notes?: string;
  size?: number;
  releaseUrl?: string;
  error?: string;
}

export interface UpdateResult {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export interface AppUpdates {
  info: () => Promise<UpdateInfo>;
  check: () => Promise<UpdateCheck>;
  download: () => Promise<UpdateResult>;
  restart: () => Promise<void>;
  openRelease: (url: string) => Promise<void>;
  onProgress: (callback: (progress: DownloadProgress) => void) => () => void;
}

declare global {
  interface Window {
    appUpdates?: AppUpdates;
  }
}

/** The bridge, or null when the app runs as a plain web page. */
export function updates(): AppUpdates | null {
  return typeof window !== 'undefined' && window.appUpdates ? window.appUpdates : null;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
