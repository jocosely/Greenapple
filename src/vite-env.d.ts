/// <reference types="vite/client" />

interface Window {
  ghostWindow?: {
    minimize: () => Promise<void>;
    startDrag: () => Promise<void>;
    toggleFullscreen: () => Promise<void>;
    close: () => Promise<void>;
  };
  ghostSpoof?: {
    setIOSLocation: (target: { lng: number; lat: number; name?: string }) => Promise<{
      ok: boolean;
      command: string[];
      stdout: string;
      stderr: string;
      error?: string;
    }>;
    resetIOSLocation: () => Promise<{
      ok: boolean;
      command: string[];
      stdout: string;
      stderr: string;
      error?: string;
    }>;
    playIOSRoute: (route: { points: Array<{ lng: number; lat: number; name?: string }>; speedKmh: number }) => Promise<{
      ok: boolean;
      command: string[];
      stdout: string;
      stderr: string;
      error?: string;
    }>;
  };
  ghostBluetooth?: {
    requestDevice: () => Promise<{
      ok: boolean;
      name?: string;
      id?: string;
      wirelessReady?: boolean;
      tunnelState?: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "SPOOFING" | "RECONNECTING" | "ERROR";
      reconnectCount?: number;
      devices?: Array<{
        name: string;
        status: string;
      }>;
      error?: string;
    }>;
    checkHealth: () => Promise<{
      ok: boolean;
      name?: string;
      id?: string;
      wirelessReady?: boolean;
      tunnelState?: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "SPOOFING" | "RECONNECTING" | "ERROR";
      reconnectCount?: number;
      error?: string;
    }>;
  };
  ghostMap?: unknown;
}
