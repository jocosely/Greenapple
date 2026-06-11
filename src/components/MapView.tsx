import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { spoofIOSLocation, spoofIOSRoute } from "../spoof/iOS";
import { useGhostStore } from "../store/useGhostStore";
import { GhostMarker } from "./GhostMarker";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
type MapTheme = {
  mapBackground: string;
  road: string;
  label: string;
};

function layerIncludes(id: string, words: string[]) {
  return words.some((word) => id.includes(word));
}

function styleGhostMap(map: Map, theme: MapTheme) {
  const style = map.getStyle();
  if (!style?.layers) return;
  const layers = style.layers;

  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", theme.mapBackground);
      }

      if (layer.type === "fill" && layerIncludes(id, ["land", "park", "building", "water", "aeroway", "boundary"])) {
        const isWater = id.includes("water");
        map.setPaintProperty(layer.id, "fill-color", isWater ? theme.mapBackground : theme.mapBackground);
        map.setPaintProperty(layer.id, "fill-opacity", id.includes("building") ? 0.28 : 1);
      }

      if (layer.type === "line" && layerIncludes(id, ["transportation", "road", "street", "highway", "motorway", "trunk", "primary", "secondary", "tunnel", "bridge", "rail"])) {
        const major = layerIncludes(id, ["motorway", "trunk", "primary", "highway", "transportation"]);
        map.setPaintProperty(layer.id, "line-color", theme.road);
        map.setPaintProperty(layer.id, "line-opacity", major ? 0.95 : 0.68);
        map.setPaintProperty(layer.id, "line-blur", major ? 0.55 : 0.12);
        map.setPaintProperty(layer.id, "line-width", [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          major ? 1.2 : 0.35,
          13,
          major ? 4.5 : 1.45,
          17,
          major ? 9 : 4
        ]);
      }

      if (layer.type === "symbol") {
        if (layerIncludes(id, ["label", "place", "poi", "road", "water", "housenumber", "transportation", "name"])) {
          const isCity = layerIncludes(id, ["place", "city", "town"]);
          map.setPaintProperty(layer.id, "text-color", isCity ? theme.label : theme.label);
          map.setPaintProperty(layer.id, "text-halo-color", theme.mapBackground);
          map.setPaintProperty(layer.id, "text-halo-width", isCity ? 1.8 : 1.2);
          map.setPaintProperty(layer.id, "text-opacity", isCity ? 0.98 : 0.92);
          map.setLayoutProperty(layer.id, "text-allow-overlap", false);
          map.setLayoutProperty(layer.id, "text-ignore-placement", false);
        }
        if (layerIncludes(id, ["poi", "icon"])) {
          map.setPaintProperty(layer.id, "icon-opacity", 0.38);
        }
      }
    } catch {
      // Public vector styles occasionally vary layer capabilities. Ignore incompatible paint properties.
    }
  }
}

function routeData(route: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: route.length >= 2 ? route : []
    }
  };
}

function getGeoJsonSource(instance: Map | null, sourceId: string) {
  if (!instance) return undefined;
  try {
    return instance.getSource(sourceId) as GeoJSONSource | undefined;
  } catch {
    return undefined;
  }
}

function fitMiniMapRoute(instance: Map, points: [number, number][]) {
  if (points.length < 2) return;
  const bounds = points.reduce(
    (nextBounds, point) => nextBounds.extend(point),
    new maplibregl.LngLatBounds(points[0], points[0])
  );
  instance.fitBounds(bounds, {
    padding: 26,
    duration: 260,
    maxZoom: 13
  });
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function routeDistanceMeters(points: [number, number][]) {
  return points.slice(1).reduce((sum, point, index) => sum + haversineMeters(points[index], point), 0);
}

function interpolatePoint(a: [number, number], b: [number, number], progress: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress];
}

function pointAtDistance(points: [number, number][], targetMeters: number): [number, number] {
  if (points.length === 0) return [-112.074, 33.4484];
  if (points.length === 1 || targetMeters <= 0) return points[0];

  let traveled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentStart = points[index - 1];
    const segmentEnd = points[index];
    const segmentMeters = haversineMeters(segmentStart, segmentEnd);
    if (traveled + segmentMeters >= targetMeters) {
      const segmentProgress = segmentMeters === 0 ? 1 : (targetMeters - traveled) / segmentMeters;
      return interpolatePoint(segmentStart, segmentEnd, segmentProgress);
    }
    traveled += segmentMeters;
  }

  return points[points.length - 1];
}

function routeFromDistance(points: [number, number][], targetMeters: number): [number, number][] {
  if (points.length < 2 || targetMeters <= 0) return points;

  let traveled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentStart = points[index - 1];
    const segmentEnd = points[index];
    const segmentMeters = haversineMeters(segmentStart, segmentEnd);
    if (traveled + segmentMeters >= targetMeters) {
      const segmentProgress = segmentMeters === 0 ? 1 : (targetMeters - traveled) / segmentMeters;
      const current = interpolatePoint(segmentStart, segmentEnd, segmentProgress);
      return [current, ...points.slice(index)];
    }
    traveled += segmentMeters;
  }

  return [points[points.length - 1]];
}

type DrivingRoute = {
  coordinates: [number, number][];
  provider: "OSRM";
};

async function snapToRoad(coords: [number, number]) {
  try {
    const url = new URL(`https://router.project-osrm.org/nearest/v1/driving/${coords[0]},${coords[1]}`);
    url.searchParams.set("number", "1");
    url.searchParams.set("radiuses", "unlimited");
    const response = await fetch(url);
    if (!response.ok) return coords;
    const body = (await response.json()) as {
      code?: string;
      waypoints?: Array<{
        location?: [number, number];
      }>;
    };
    const snapped = body.waypoints?.[0]?.location;
    return body.code === "Ok" && snapped ? snapped : coords;
  } catch {
    return coords;
  }
}

async function fetchOsrmDrivingRoute(start: [number, number], end: [number, number]): Promise<DrivingRoute | null> {
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  url.searchParams.set("continue_straight", "false");
  url.searchParams.set("radiuses", "unlimited;unlimited");

  const response = await fetch(url);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    code?: string;
    routes?: Array<{
      geometry?: {
        coordinates?: [number, number][];
      };
    }>;
  };
  const coordinates = body.routes?.[0]?.geometry?.coordinates;
  return body.code === "Ok" && coordinates && coordinates.length >= 2 ? { coordinates, provider: "OSRM" } : null;
}

async function fetchDrivingRoute(start: [number, number], end: [number, number]) {
  try {
    const osrmRoute = await fetchOsrmDrivingRoute(start, end);
    if (osrmRoute) return osrmRoute;
  } catch {
    // Report a clean status below.
  }

  throw new Error("No drivable road route found between those points.");
}

function routeDurationMs(distanceMeters: number, speedKmh: number) {
  const metersPerSecond = Math.max(1, speedKmh) / 3.6;
  return Math.max(9000, (distanceMeters / metersPerSecond) * 1000);
}

async function reverseGeocode(coords: [number, number]) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(coords[1]));
    url.searchParams.set("lon", String(coords[0]));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = (await response.json()) as {
      name?: string;
      display_name?: string;
      address?: Record<string, string>;
    };
    const address = body.address ?? {};
    return (
      address.road ||
      address.pedestrian ||
      address.neighbourhood ||
      address.suburb ||
      address.city ||
      address.town ||
      body.name ||
      body.display_name?.split(",")[0] ||
      `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`
    );
  } catch {
    return `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`;
  }
}

export function MapView() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const miniMapNode = useRef<HTMLDivElement | null>(null);
  const markerNode = useRef<HTMLDivElement | null>(null);
  const markerRoot = useRef<Root | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const map = useRef<Map | null>(null);
  const miniMap = useRef<Map | null>(null);
  const routeAnimation = useRef<number | null>(null);
  const arrivalResetTimer = useRef<number | null>(null);
  const lastRouteGpsPush = useRef(0);
  const routeGpsPushInFlight = useRef(false);
  const pendingRouteGpsPush = useRef<{ point: [number, number]; label: string; force: boolean } | null>(null);

  const coords = useGhostStore((state) => state.coords);
  const cityName = useGhostStore((state) => state.cityName);
  const mode = useGhostStore((state) => state.mode);
  const route = useGhostStore((state) => state.route);
  const routeRunning = useGhostStore((state) => state.routeRunning);
  const routePaused = useGhostStore((state) => state.routePaused);
  const routeSpeedKmh = useGhostStore((state) => state.routeSpeedKmh);
  const routeTravelMode = useGhostStore((state) => state.routeTravelMode);
  const naturalMovement = useGhostStore((state) => state.naturalMovement);
  const randomDrift = useGhostStore((state) => state.randomDrift);
  const patrolPoints = useGhostStore((state) => state.patrolPoints);
  const patrolRunning = useGhostStore((state) => state.patrolRunning);
  const themeColors = useGhostStore((state) => state.themeColors);
  const setCoords = useGhostStore((state) => state.setCoords);
  const naturalProgress = useRef(0);

  function stopRouteAnimation() {
    if (routeAnimation.current) window.cancelAnimationFrame(routeAnimation.current);
    if (arrivalResetTimer.current) window.clearTimeout(arrivalResetTimer.current);
    routeAnimation.current = null;
    arrivalResetTimer.current = null;
    lastRouteGpsPush.current = 0;
    pendingRouteGpsPush.current = null;
    naturalProgress.current = 0;
  }

  function updateRouteStats(points: [number, number][]) {
    const distanceMeters = routeDistanceMeters(points);
    const store = useGhostStore.getState();
    const arrivalMinutes = store.arrivalMinutes;
    if (arrivalMinutes > 0 && distanceMeters > 0) {
      store.setRouteSpeedKmh(Math.max(1, Math.round((distanceMeters / (arrivalMinutes * 60)) * 3.6)));
    }
    const speedKmh = useGhostStore.getState().routeSpeedKmh;
    store.setRouteStats({
      distanceMeters,
      etaSeconds: distanceMeters > 0 ? distanceMeters / (speedKmh / 3.6) : 0
    });
  }

  async function pushRouteGps(point: [number, number], label: string, force = false) {
    const now = performance.now();
    if (!force && now - lastRouteGpsPush.current < 1800) return;
    if (routeGpsPushInFlight.current) {
      pendingRouteGpsPush.current = { point, label, force };
      return;
    }

    lastRouteGpsPush.current = now;
    routeGpsPushInFlight.current = true;
    try {
      await spoofIOSLocation({ lng: point[0], lat: point[1], name: label });
      useGhostStore.setState({ spoofStatus: `${label} on iPhone` });
    } catch (error) {
      useGhostStore.setState({
        spoofStatus: error instanceof Error ? error.message : "Route GPS update failed"
      });
    } finally {
      routeGpsPushInFlight.current = false;
      const pending = pendingRouteGpsPush.current;
      pendingRouteGpsPush.current = null;
      if (pending) {
        window.setTimeout(() => void pushRouteGps(pending.point, pending.label, pending.force), 0);
      }
    }
  }

  async function prepareDrivingRoute(start: [number, number], end: [number, number]) {
    stopRouteAnimation();
    const store = useGhostStore.getState();
    store.setRouteRunning(false);
    store.setRoute([]);
    store.renameCurrentLocation("Building route...");
    useGhostStore.setState({ spoofStatus: "Finding real road route..." });

    let drivingRoute: DrivingRoute;
    try {
      drivingRoute = await fetchDrivingRoute(start, end);
    } catch (error) {
      store.setRoute([]);
      useGhostStore.setState({ spoofStatus: error instanceof Error ? error.message : "Route failed" });
      await store.setCoords(start, "Route Start");
      return;
    }

    const snappedStart = drivingRoute.coordinates[0];
    store.setRoute(drivingRoute.coordinates);
    updateRouteStats(drivingRoute.coordinates);
    await store.setCoords(snappedStart, "Route Ready");
    store.setSpeed("Driving");
    useGhostStore.setState({ spoofStatus: `Route ready via ${drivingRoute.provider}` });
  }

  async function prepareBoatRoute(start: [number, number], end: [number, number]) {
    stopRouteAnimation();
    const store = useGhostStore.getState();
    store.setRouteRunning(false);
    store.setRoute([start, end]);
    updateRouteStats([start, end]);
    await store.setCoords(start, "Boat Start");
    useGhostStore.setState({ spoofStatus: "Boat route ready" });
  }

  async function prepareOffRoadRoute(start: [number, number], end: [number, number]) {
    stopRouteAnimation();
    const store = useGhostStore.getState();
    store.setRouteRunning(false);
    store.setRoute([start, end]);
    updateRouteStats([start, end]);
    await store.setCoords(start, "Route Start");
    useGhostStore.setState({ spoofStatus: "Off-road route ready" });
  }

  async function startPreparedRoute(points: [number, number][]) {
    stopRouteAnimation();
    if (points.length < 2) return;
    const distance = Math.max(routeDistanceMeters(points), 1);
    const currentSpeedKmh = useGhostStore.getState().routeSpeedKmh;
    const currentTravelMode = useGhostStore.getState().routeTravelMode;
    const visualDurationMs = routeDurationMs(distance, currentSpeedKmh);
    const startProgress = Math.max(0, Math.min(0.98, useGhostStore.getState().routeProgress));
    const end = points[points.length - 1];
    const movingLabel = currentTravelMode === "Boat" ? "Boating" : "Driving";
    const startMeters = distance * startProgress;
    const startPoint = pointAtDistance(points, startMeters);
    const routePoints = routeFromDistance(points, startMeters);
    naturalProgress.current = startProgress;
    await useGhostStore.getState().setCoords(startPoint, movingLabel);
    useGhostStore.setState({ spoofStatus: `Starting ${movingLabel.toLowerCase()} GPS route at ${currentSpeedKmh} km/h` });
    try {
      await spoofIOSRoute(
        routePoints.map((point) => ({ lng: point[0], lat: point[1], name: movingLabel })),
        currentSpeedKmh
      );
      useGhostStore.setState({ spoofStatus: `${movingLabel} GPS route active at ${currentSpeedKmh} km/h` });
    } catch (error) {
      useGhostStore.setState({ spoofStatus: error instanceof Error ? error.message : "Route GPS start failed" });
      return;
    }

    const started = performance.now() - visualDurationMs * startProgress;
    const frame = async (now: number) => {
      if (useGhostStore.getState().routePaused) {
        stopRouteAnimation();
        return;
      }
      const rawProgress = Math.min(1, (now - started) / visualDurationMs);
      const easedProgress = useGhostStore.getState().naturalMovement
        ? Math.min(1, Math.max(naturalProgress.current, rawProgress + Math.sin(rawProgress * Math.PI * 10) * 0.004))
        : rawProgress;
      const progress = Math.max(naturalProgress.current, easedProgress);
      naturalProgress.current = progress;
      const next = pointAtDistance(points, distance * progress);
      marker.current?.setLngLat(next);
      map.current?.easeTo({
        center: next,
        duration: 180,
        pitch: 45
      });
      useGhostStore.setState({ coords: next, cityName: progress >= 1 ? "Route End" : movingLabel });
      useGhostStore.getState().setRouteProgress(progress);

      if (progress < 1) {
        routeAnimation.current = window.requestAnimationFrame(frame);
        return;
      }

      routeAnimation.current = null;
      if (useGhostStore.getState().mode === "Patrol" && useGhostStore.getState().patrolRunning) {
        useGhostStore.getState().setRouteProgress(0);
        naturalProgress.current = 0;
        routeAnimation.current = window.requestAnimationFrame(() => void startPreparedRoute(points));
        return;
      }
      useGhostStore.getState().setRouteRunning(false);
      useGhostStore.getState().setRouteProgress(0);
      const endName = await reverseGeocode(end);
      useGhostStore.getState().renameCurrentLocation(endName);
      void pushRouteGps(end, endName, true);
      const store = useGhostStore.getState();
      if (store.arrivalAction === "Reset") {
        const seconds = store.arrivalReturnSeconds;
        useGhostStore.setState({ spoofStatus: seconds > 0 ? `Route complete. Resetting in ${seconds}s` : "Route complete. Resetting now" });
        arrivalResetTimer.current = window.setTimeout(() => {
          arrivalResetTimer.current = null;
          void useGhostStore.getState().resetLocation();
        }, seconds * 1000);
      } else {
        useGhostStore.setState({ spoofStatus: `Route complete. Holding ${endName}` });
      }
    };

    routeAnimation.current = window.requestAnimationFrame(frame);
  }

  useEffect(() => {
    if (!mapNode.current || map.current) return;

    const instance = new maplibregl.Map({
      container: mapNode.current,
      style: CARTO_DARK_STYLE,
      center: coords,
      zoom: 13.2,
      pitch: 45,
      bearing: 0,
      maxPitch: 65,
      renderWorldCopies: false,
      attributionControl: false
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "bottom-right");
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    markerNode.current = document.createElement("div");
    markerRoot.current = createRoot(markerNode.current);
    markerRoot.current.render(<GhostMarker cityName={cityName} />);
    marker.current = new maplibregl.Marker({ element: markerNode.current, anchor: "bottom", draggable: true })
      .setLngLat(coords)
      .addTo(instance);

    marker.current.on("dragend", async () => {
      stopRouteAnimation();
      const point = marker.current?.getLngLat();
      if (!point) return;
      const next: [number, number] = [point.lng, point.lat];
      await useGhostStore.getState().setCoords(next, "Locating...");
      useGhostStore.getState().renameCurrentLocation(await reverseGeocode(next));
    });

    instance.on("load", () => {
      styleGhostMap(instance, useGhostStore.getState().themeColors);
      if (!instance.getSource("ghost-route")) {
        instance.addSource("ghost-route", {
          type: "geojson",
          data: routeData([])
        });
        instance.addLayer({
          id: "ghost-route-glow",
          type: "line",
          source: "ghost-route",
          paint: {
            "line-color": useGhostStore.getState().themeColors.road,
            "line-width": 10,
            "line-opacity": 0.22,
            "line-blur": 5
          }
        });
        instance.addLayer({
          id: "ghost-route-line",
          type: "line",
          source: "ghost-route",
          paint: {
            "line-color": useGhostStore.getState().themeColors.road,
            "line-width": 4,
            "line-opacity": 0.95
          }
        });
      }
    });

    instance.on("styledata", () => styleGhostMap(instance, useGhostStore.getState().themeColors));

    instance.on("click", async (event) => {
      const next: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      if (useGhostStore.getState().mode === "Patrol") {
        stopRouteAnimation();
        useGhostStore.getState().addPatrolPoint(next);
        return;
      }
      if (useGhostStore.getState().mode === "Route") {
        const currentRoute = useGhostStore.getState().route;
        const travelMode = useGhostStore.getState().routeTravelMode;
        if (currentRoute.length === 0 || currentRoute.length > 1) {
          stopRouteAnimation();
          useGhostStore.getState().setRoute([]);
          const shouldSnap = travelMode === "Road" && useGhostStore.getState().roadSnapEnabled;
          useGhostStore.setState({ spoofStatus: travelMode === "Boat" ? "Boat start selected" : shouldSnap ? "Snapping start to road..." : "Route start selected" });
          const snappedStart = shouldSnap ? await snapToRoad(next) : next;
          useGhostStore.getState().setRoute([snappedStart]);
          await setCoords(snappedStart, travelMode === "Boat" ? "Boat Start" : "Route Start");
          useGhostStore.setState({ spoofStatus: "Click destination" });
          return;
        }
        const shouldSnap = travelMode === "Road" && useGhostStore.getState().roadSnapEnabled;
        useGhostStore.setState({ spoofStatus: travelMode === "Boat" ? "Boat destination selected" : shouldSnap ? "Snapping destination to road..." : "Route destination selected" });
        if (travelMode === "Boat") {
          await prepareBoatRoute(currentRoute[0], next);
          return;
        }
        if (!shouldSnap) {
          await prepareOffRoadRoute(currentRoute[0], next);
          return;
        }
        const snappedEnd = await snapToRoad(next);
        await prepareDrivingRoute(currentRoute[0], snappedEnd);
      } else {
        stopRouteAnimation();
        await setCoords(next, "Locating...");
        useGhostStore.getState().renameCurrentLocation(await reverseGeocode(next));
      }
    });

    map.current = instance;
    window.ghostMap = instance;
    return () => {
      stopRouteAnimation();
      miniMap.current?.remove();
      miniMap.current = null;
      instance.remove();
      if (map.current === instance) map.current = null;
      if (window.ghostMap === instance) window.ghostMap = undefined;
    };
  }, []);

  useEffect(() => {
    if (!miniMapNode.current || miniMap.current || route.length < 2) return;

    const instance = new maplibregl.Map({
      container: miniMapNode.current,
      style: CARTO_DARK_STYLE,
      center: coords,
      zoom: 8,
      renderWorldCopies: false,
      interactive: false,
      attributionControl: false
    });

    instance.on("load", () => {
      styleGhostMap(instance, useGhostStore.getState().themeColors);
      instance.addSource("ghost-mini-route", {
        type: "geojson",
        data: routeData(useGhostStore.getState().route)
      });
      instance.addLayer({
        id: "ghost-mini-route-glow",
        type: "line",
        source: "ghost-mini-route",
        paint: {
          "line-color": useGhostStore.getState().themeColors.road,
          "line-width": 7,
          "line-opacity": 0.2,
          "line-blur": 4
        }
      });
      instance.addLayer({
        id: "ghost-mini-route-line",
        type: "line",
        source: "ghost-mini-route",
        paint: {
          "line-color": useGhostStore.getState().themeColors.road,
          "line-width": 2.5,
          "line-opacity": 0.95
        }
      });
      fitMiniMapRoute(instance, useGhostStore.getState().route);
    });

    instance.on("styledata", () => styleGhostMap(instance, useGhostStore.getState().themeColors));
    miniMap.current = instance;
  }, [route.length, coords]);

  useEffect(() => {
    marker.current?.setLngLat(coords);
    if (routeAnimation.current) return;
    map.current?.flyTo({
      center: coords,
      zoom: Math.max(map.current.getZoom(), 13),
      pitch: 45,
      duration: 800
    });
  }, [coords]);

  useEffect(() => {
    markerRoot.current?.render(<GhostMarker cityName={cityName} />);
  }, [cityName]);

  useEffect(() => {
    if (route.length < 2 && miniMap.current) {
      miniMap.current.remove();
      miniMap.current = null;
    }
    if (route.length === 0) stopRouteAnimation();
    const source = getGeoJsonSource(map.current, "ghost-route");
    source?.setData(routeData(route));
    const miniSource = getGeoJsonSource(miniMap.current, "ghost-mini-route");
    miniSource?.setData(routeData(route));
    if (route.length >= 2 && miniMap.current) fitMiniMapRoute(miniMap.current, route);
  }, [route]);

  useEffect(() => {
    if (!routeRunning || routePaused) {
      stopRouteAnimation();
      return;
    }
    void startPreparedRoute(useGhostStore.getState().route);
  }, [routeRunning, routePaused, routeSpeedKmh]);

  useEffect(() => {
    if (mode === "Route" && route.length > 0 && !routeRunning) {
      useGhostStore.getState().setRoute([]);
      const source = getGeoJsonSource(map.current, "ghost-route");
      source?.setData(routeData([]));
    }
  }, [routeTravelMode]);

  useEffect(() => {
    if (mode !== "Route" && mode !== "Patrol") {
      stopRouteAnimation();
      useGhostStore.getState().setRouteRunning(false);
      const source = getGeoJsonSource(map.current, "ghost-route");
      source?.setData(routeData([]));
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "Patrol") return;
    const displayRoute =
      patrolPoints.length > 2 ? [...patrolPoints, patrolPoints[0]] : patrolPoints.length === 2 ? patrolPoints : [];
    const source = getGeoJsonSource(map.current, "ghost-route");
    source?.setData(routeData(displayRoute));
    if (!patrolRunning) useGhostStore.getState().setRoute(displayRoute);
  }, [patrolPoints, mode, patrolRunning]);

  useEffect(() => {
    if (!randomDrift || mode !== "Static" || routeRunning) return;
    const timer = window.setInterval(() => {
      const [lng, lat] = useGhostStore.getState().coords;
      const meters = 7 + Math.random() * 18;
      const angle = Math.random() * Math.PI * 2;
      const next: [number, number] = [
        lng + (Math.cos(angle) * meters) / (111320 * Math.cos((lat * Math.PI) / 180)),
        lat + (Math.sin(angle) * meters) / 111320
      ];
      useGhostStore.setState({ coords: next, cityName: "Drifting", spoofStatus: "Random drift update" });
      void pushRouteGps(next, "Drifting", true);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [randomDrift, mode, routeRunning]);

  useEffect(() => {
    if (!map.current) return;
    styleGhostMap(map.current, themeColors);
    if (miniMap.current) styleGhostMap(miniMap.current, themeColors);
    for (const layerId of ["ghost-route-glow", "ghost-route-line"]) {
      if (map.current.getLayer(layerId)) {
        map.current.setPaintProperty(layerId, "line-color", themeColors.road);
      }
    }
    for (const layerId of ["ghost-mini-route-glow", "ghost-mini-route-line"]) {
      if (miniMap.current?.getLayer(layerId)) {
        miniMap.current.setPaintProperty(layerId, "line-color", themeColors.road);
      }
    }
  }, [themeColors]);

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={mapNode} className="h-full w-full" />
      {route.length >= 2 && (
        <div className="ghost-liquid liquid-lens fixed bottom-[136px] right-8 z-30 h-[158px] w-[236px] overflow-hidden rounded-[26px] border border-black/70 bg-black/35 shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
          <div ref={miniMapNode} className="h-full w-full opacity-95" />
          <div className="pointer-events-none absolute left-3 top-2 rounded-full bg-black/35 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white/65">Route</div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0_48%,rgba(0,0,0,0.22)_76%,rgba(0,0,0,0.6)_100%)]" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/45" />
    </div>
  );
}
