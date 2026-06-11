import { create } from "zustand";
import { resetIOSLocation, spoofIOSLocation } from "../spoof/iOS";

export type GhostMode = "Static" | "Route" | "Patrol";
export type ThemeColors = {
  mapBackground: string;
  road: string;
  label: string;
  accent: string;
};

export type GhostLocation = {
  id: string;
  name: string;
  lng: number;
  lat: number;
};
export type SavedTheme = {
  id: string;
  name: string;
  colors: ThemeColors;
};
export type RouteStats = {
  distanceMeters: number;
  etaSeconds: number;
};

type RouteSpeed = "Walking" | "Cycling" | "Driving";
export type RouteTravelMode = "Road" | "Boat";
export type ArrivalAction = "Hold" | "Reset";

type GhostState = {
  coords: [number, number];
  cityName: string;
  deviceName: string;
  bluetoothName: string;
  bluetoothStatus: string;
  spoofStatus: string;
  mode: GhostMode;
  speed: RouteSpeed;
  routeSpeedKmh: number;
  routeTravelMode: RouteTravelMode;
  routePaused: boolean;
  routeProgress: number;
  routeStats: RouteStats;
  arrivalMinutes: number;
  arrivalAction: ArrivalAction;
  arrivalReturnSeconds: number;
  roadSnapEnabled: boolean;
  naturalMovement: boolean;
  randomDrift: boolean;
  patrolPoints: [number, number][];
  patrolRunning: boolean;
  favoriteSlots: GhostLocation[];
  savedThemes: SavedTheme[];
  connectionHealth: string;
  saved: GhostLocation[];
  recent: GhostLocation[];
  route: [number, number][];
  routeRunning: boolean;
  themeColors: ThemeColors;
  setCoords: (coords: [number, number], name?: string) => Promise<void>;
  applyCurrentLocation: () => Promise<void>;
  resetLocation: () => Promise<void>;
  setMode: (mode: GhostMode) => void;
  setDeviceName: (name: string) => void;
  setBluetoothState: (name: string, status: string) => void;
  setSpeed: (speed: RouteSpeed) => void;
  setRouteSpeedKmh: (speed: number) => void;
  setRouteTravelMode: (mode: RouteTravelMode) => void;
  setRoutePaused: (paused: boolean) => void;
  setRouteProgress: (progress: number) => void;
  setRouteStats: (stats: RouteStats) => void;
  setArrivalMinutes: (minutes: number) => void;
  setArrivalAction: (action: ArrivalAction) => void;
  setArrivalReturnSeconds: (seconds: number) => void;
  setRoadSnapEnabled: (enabled: boolean) => void;
  setNaturalMovement: (enabled: boolean) => void;
  setRandomDrift: (enabled: boolean) => void;
  addPatrolPoint: (coords: [number, number]) => void;
  clearPatrol: () => void;
  setPatrolRunning: (running: boolean) => void;
  addFavoriteSlot: () => void;
  loadFavoriteSlot: (location: GhostLocation) => Promise<void>;
  removeFavoriteSlot: (id: string) => void;
  setThemeColor: (key: keyof ThemeColors, color: string) => void;
  resetThemeColors: () => void;
  saveTheme: (name: string) => void;
  applyTheme: (theme: SavedTheme) => void;
  removeTheme: (id: string) => void;
  setConnectionHealth: (health: string) => void;
  addRoutePoint: (coords: [number, number]) => void;
  setRoute: (route: [number, number][]) => void;
  setRouteRunning: (running: boolean) => void;
  clearRoute: () => void;
  saveCurrent: () => void;
  addRecent: (location: GhostLocation) => void;
  loadLocation: (location: GhostLocation) => Promise<void>;
  renameCurrentLocation: (name: string) => void;
};

const savedKey = "greenapple.savedLocations";
const recentKey = "greenapple.recentLocations";
const themeKey = "greenapple.themeColors";
const themesKey = "greenapple.savedThemes";
const favoritesKey = "greenapple.favoriteSlots";
const defaultThemeColors: ThemeColors = {
  mapBackground: "#000000",
  road: "#00FF9C",
  label: "#8B9298",
  accent: "#00FF9C"
};
const colorPattern = /^#[0-9a-f]{6}$/i;

function readLocations(key: string): GhostLocation[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as GhostLocation[];
  } catch {
    return [];
  }
}

function writeLocations(key: string, locations: GhostLocation[]) {
  localStorage.setItem(key, JSON.stringify(locations));
}

function readSavedThemes(): SavedTheme[] {
  try {
    const themes = JSON.parse(localStorage.getItem(themesKey) || "[]") as SavedTheme[];
    return themes.filter((theme) => theme.id && theme.name && theme.colors);
  } catch {
    return [];
  }
}

function writeSavedThemes(themes: SavedTheme[]) {
  localStorage.setItem(themesKey, JSON.stringify(themes));
}

function readThemeColors(): ThemeColors {
  try {
    const stored = JSON.parse(localStorage.getItem(themeKey) || "{}") as Partial<ThemeColors>;
    const theme = { ...defaultThemeColors };
    for (const key of Object.keys(defaultThemeColors) as Array<keyof ThemeColors>) {
      if (typeof stored[key] === "string" && colorPattern.test(stored[key])) {
        theme[key] = stored[key];
      }
    }
    if (theme.road.toLowerCase() === theme.mapBackground.toLowerCase()) theme.road = defaultThemeColors.road;
    if (theme.label.toLowerCase() === theme.mapBackground.toLowerCase()) theme.label = defaultThemeColors.label;
    if (theme.accent.toLowerCase() === theme.mapBackground.toLowerCase()) theme.accent = defaultThemeColors.accent;
    return theme;
  } catch {
    return defaultThemeColors;
  }
}

function writeThemeColors(colors: ThemeColors) {
  localStorage.setItem(themeKey, JSON.stringify(colors));
}

function locationFrom(coords: [number, number], name: string): GhostLocation {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    lng: coords[0],
    lat: coords[1]
  };
}

export const useGhostStore = create<GhostState>((set, get) => ({
  coords: [-112.074, 33.4484],
  cityName: "Phoenix",
  deviceName: "iPhone",
  bluetoothName: "",
  bluetoothStatus: "Bluetooth not connected",
  spoofStatus: "Ready",
  mode: "Static",
  speed: "Walking",
  routeSpeedKmh: 90,
  routeTravelMode: "Road",
  routePaused: false,
  routeProgress: 0,
  routeStats: { distanceMeters: 0, etaSeconds: 0 },
  arrivalMinutes: 0,
  arrivalAction: "Hold",
  arrivalReturnSeconds: 10,
  roadSnapEnabled: true,
  naturalMovement: true,
  randomDrift: false,
  patrolPoints: [],
  patrolRunning: false,
  favoriteSlots: readLocations(favoritesKey),
  savedThemes: readSavedThemes(),
  connectionHealth: "Not checked",
  saved: readLocations(savedKey),
  recent: readLocations(recentKey),
  route: [],
  routeRunning: false,
  themeColors: readThemeColors(),
  setCoords: async (coords, name = "Phoenix") => {
    set({ coords, cityName: name, spoofStatus: "Location ready" });
  },
  applyCurrentLocation: async () => {
    const { coords, cityName } = get();
    set({ spoofStatus: "Changing iPhone location..." });
    try {
      await spoofIOSLocation({ lng: coords[0], lat: coords[1], name: cityName });
      set({ spoofStatus: "iPhone location held active" });
    } catch (error) {
      set({ spoofStatus: error instanceof Error ? error.message : "iPhone location command failed" });
      return;
    }
    const recent = [locationFrom(coords, cityName), ...get().recent].slice(0, 50);
    writeLocations(recentKey, recent);
    set({ recent });
  },
  resetLocation: async () => {
    set({ spoofStatus: "Resetting iPhone location..." });
    try {
      await resetIOSLocation();
      set({ spoofStatus: "iPhone location reset" });
    } catch (error) {
      set({ spoofStatus: error instanceof Error ? error.message : "Reset failed" });
    }
  },
  setMode: (mode) =>
    set({
      mode,
      route: [],
      routeRunning: false,
      routePaused: false,
      routeProgress: 0,
      patrolRunning: false,
      spoofStatus: mode === "Static" ? "Ready" : get().spoofStatus
    }),
  setDeviceName: (deviceName) => set({ deviceName }),
  setBluetoothState: (bluetoothName, bluetoothStatus) => set({ bluetoothName, bluetoothStatus }),
  setSpeed: (speed) => {
    const speedByMode: Record<RouteSpeed, number> = {
      Walking: 5,
      Cycling: 18,
      Driving: 90
    };
    set({ speed, routeSpeedKmh: speedByMode[speed] });
  },
  setRouteSpeedKmh: (routeSpeedKmh) => {
    const speed = Math.max(1, Math.min(300, Math.round(routeSpeedKmh)));
    const { routeStats } = get();
    set({
      routeSpeedKmh: speed,
      routeStats: {
        distanceMeters: routeStats.distanceMeters,
        etaSeconds: routeStats.distanceMeters > 0 ? routeStats.distanceMeters / (speed / 3.6) : 0
      }
    });
  },
  setRouteTravelMode: (routeTravelMode) =>
    set({
      routeTravelMode,
      route: [],
      routeRunning: false,
      routePaused: false,
      routeProgress: 0,
      spoofStatus: `${routeTravelMode} route mode`
    }),
  setRoutePaused: (routePaused) => set({ routePaused, spoofStatus: routePaused ? "Route paused" : "Route resumed" }),
  setRouteProgress: (routeProgress) => set({ routeProgress: Math.max(0, Math.min(1, routeProgress)) }),
  setRouteStats: (routeStats) => set({ routeStats }),
  setArrivalMinutes: (arrivalMinutes) => set({ arrivalMinutes: Math.max(0, Math.min(1440, Math.round(arrivalMinutes))) }),
  setArrivalAction: (arrivalAction) => set({ arrivalAction, spoofStatus: arrivalAction === "Reset" ? "Auto reset after arrival" : "Hold after arrival" }),
  setArrivalReturnSeconds: (arrivalReturnSeconds) => set({ arrivalReturnSeconds: Math.max(0, Math.min(600, Math.round(arrivalReturnSeconds))) }),
  setRoadSnapEnabled: (roadSnapEnabled) => set({ roadSnapEnabled, spoofStatus: roadSnapEnabled ? "Road lock on" : "Road lock off" }),
  setNaturalMovement: (naturalMovement) => set({ naturalMovement }),
  setRandomDrift: (randomDrift) => set({ randomDrift, spoofStatus: randomDrift ? "Random drift on" : "Random drift off" }),
  addPatrolPoint: (coords) => {
    const patrolPoints = [...get().patrolPoints, coords];
    set({ patrolPoints, coords, cityName: `Patrol ${patrolPoints.length}`, spoofStatus: "Patrol point added" });
  },
  clearPatrol: () => set({ patrolPoints: [], patrolRunning: false, route: [], routeRunning: false, routePaused: false, routeProgress: 0 }),
  setPatrolRunning: (patrolRunning) => set({ patrolRunning, routeRunning: patrolRunning, routePaused: false }),
  addFavoriteSlot: () => {
    const current = locationFrom(get().coords, get().cityName || "Favorite");
    const favoriteSlots = [current, ...get().favoriteSlots].slice(0, 8);
    writeLocations(favoritesKey, favoriteSlots);
    set({ favoriteSlots, spoofStatus: "Favorite saved" });
  },
  loadFavoriteSlot: async (location) => {
    await get().setCoords([location.lng, location.lat], location.name);
  },
  removeFavoriteSlot: (id) => {
    const favoriteSlots = get().favoriteSlots.filter((location) => location.id !== id);
    writeLocations(favoritesKey, favoriteSlots);
    set({ favoriteSlots });
  },
  setThemeColor: (key, color) => {
    if (!colorPattern.test(color)) return;
    const themeColors = { ...get().themeColors, [key]: color };
    if (key === "mapBackground") {
      if (themeColors.road.toLowerCase() === color.toLowerCase()) themeColors.road = defaultThemeColors.road;
      if (themeColors.label.toLowerCase() === color.toLowerCase()) themeColors.label = defaultThemeColors.label;
      if (themeColors.accent.toLowerCase() === color.toLowerCase()) themeColors.accent = defaultThemeColors.accent;
    } else if (color.toLowerCase() === themeColors.mapBackground.toLowerCase()) {
      themeColors[key] = defaultThemeColors[key];
    }
    writeThemeColors(themeColors);
    set({ themeColors });
  },
  resetThemeColors: () => {
    writeThemeColors(defaultThemeColors);
    set({ themeColors: defaultThemeColors });
  },
  saveTheme: (name) => {
    const savedThemes = [
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: name.trim() || "Theme", colors: get().themeColors },
      ...get().savedThemes
    ].slice(0, 12);
    writeSavedThemes(savedThemes);
    set({ savedThemes, spoofStatus: "Theme saved" });
  },
  applyTheme: (theme) => {
    writeThemeColors(theme.colors);
    set({ themeColors: theme.colors, spoofStatus: `${theme.name} theme applied` });
  },
  removeTheme: (id) => {
    const savedThemes = get().savedThemes.filter((theme) => theme.id !== id);
    writeSavedThemes(savedThemes);
    set({ savedThemes });
  },
  setConnectionHealth: (connectionHealth) => set({ connectionHealth }),
  addRoutePoint: (coords) => {
    const next = [...get().route, coords].slice(-2);
    set({ route: next, coords, cityName: next.length === 1 ? "Route Start" : "Route Ready" });
  },
  setRoute: (route) => set({ route }),
  setRouteRunning: (routeRunning) => set({ routeRunning, routePaused: false }),
  clearRoute: () => set({ route: [], routeRunning: false, routePaused: false, routeProgress: 0, patrolRunning: false }),
  saveCurrent: () => {
    const current = locationFrom(get().coords, get().cityName);
    const saved = [current, ...get().saved];
    writeLocations(savedKey, saved);
    set({ saved });
  },
  addRecent: (location) => {
    const recent = [location, ...get().recent.filter((item) => item.id !== location.id)].slice(0, 10);
    writeLocations(recentKey, recent);
    set({ recent });
  },
  loadLocation: async (location) => {
    await get().setCoords([location.lng, location.lat], location.name);
  },
  renameCurrentLocation: (name) => set({ cityName: name })
}));
