// The desktop app's bridge (desktop/preload.ts). In a browser there is none, and the page works as
// before; `?mode=widget` shows the compact widget layout anyway, for trying it out.

export interface DesktopPrefs {
  /** The widget stays above other windows. */
  onTop: boolean;
  /** Mote starts (into the tray) when you log in. */
  autostart: boolean;
  /** Opening Mote shows the widget instead of the full window. */
  widgetFirst: boolean;
}

export interface MoteDesktop {
  mode: 'app' | 'widget';
  platform: string;
  openApp(): void;
  openWidget(): void;
  hide(): void;
  getPrefs(): Promise<DesktopPrefs>;
  setPref<K extends keyof DesktopPrefs>(key: K, value: DesktopPrefs[K]): Promise<DesktopPrefs>;
}

export const desktop: MoteDesktop | null = (window as unknown as { moteDesktop?: MoteDesktop }).moteDesktop ?? null;

export const viewMode: 'app' | 'widget' = desktop?.mode ?? (new URLSearchParams(location.search).get('mode') === 'widget' ? 'widget' : 'app');
