import { AlertTriangle, Car, Clock3, Download, Heart, Lock, Pause, Play, RotateCcw, Settings, Ship, Square, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { RouteTravelMode, useGhostStore } from "../store/useGhostStore";

type Props = {
  onOpenSettings: () => void;
};

function metersBetween(a: [number, number], b: [number, number]) {
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

function routeDistance(points: [number, number][]) {
  return points.slice(1).reduce((sum, point, index) => sum + metersBetween(points[index], point), 0);
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function closedPatrol(points: [number, number][]) {
  return points.length > 2 ? [...points, points[0]] : points;
}

export function BottomControls({ onOpenSettings }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const importInput = useRef<HTMLInputElement | null>(null);
  const saveCurrent = useGhostStore((state) => state.saveCurrent);
  const addFavoriteSlot = useGhostStore((state) => state.addFavoriteSlot);
  const applyCurrentLocation = useGhostStore((state) => state.applyCurrentLocation);
  const resetLocation = useGhostStore((state) => state.resetLocation);
  const mode = useGhostStore((state) => state.mode);
  const recent = useGhostStore((state) => state.recent);
  const favoriteSlots = useGhostStore((state) => state.favoriteSlots);
  const loadLocation = useGhostStore((state) => state.loadLocation);
  const loadFavoriteSlot = useGhostStore((state) => state.loadFavoriteSlot);
  const removeFavoriteSlot = useGhostStore((state) => state.removeFavoriteSlot);
  const route = useGhostStore((state) => state.route);
  const routeRunning = useGhostStore((state) => state.routeRunning);
  const routePaused = useGhostStore((state) => state.routePaused);
  const routeProgress = useGhostStore((state) => state.routeProgress);
  const routeStats = useGhostStore((state) => state.routeStats);
  const routeSpeedKmh = useGhostStore((state) => state.routeSpeedKmh);
  const routeTravelMode = useGhostStore((state) => state.routeTravelMode);
  const arrivalMinutes = useGhostStore((state) => state.arrivalMinutes);
  const arrivalAction = useGhostStore((state) => state.arrivalAction);
  const arrivalReturnSeconds = useGhostStore((state) => state.arrivalReturnSeconds);
  const roadSnapEnabled = useGhostStore((state) => state.roadSnapEnabled);
  const patrolPoints = useGhostStore((state) => state.patrolPoints);
  const patrolRunning = useGhostStore((state) => state.patrolRunning);
  const clearRoute = useGhostStore((state) => state.clearRoute);
  const clearPatrol = useGhostStore((state) => state.clearPatrol);
  const setRoute = useGhostStore((state) => state.setRoute);
  const setRouteRunning = useGhostStore((state) => state.setRouteRunning);
  const setRoutePaused = useGhostStore((state) => state.setRoutePaused);
  const setRouteSpeedKmh = useGhostStore((state) => state.setRouteSpeedKmh);
  const setRouteTravelMode = useGhostStore((state) => state.setRouteTravelMode);
  const setRouteStats = useGhostStore((state) => state.setRouteStats);
  const setArrivalMinutes = useGhostStore((state) => state.setArrivalMinutes);
  const setArrivalAction = useGhostStore((state) => state.setArrivalAction);
  const setArrivalReturnSeconds = useGhostStore((state) => state.setArrivalReturnSeconds);
  const setRoadSnapEnabled = useGhostStore((state) => state.setRoadSnapEnabled);
  const setPatrolRunning = useGhostStore((state) => state.setPatrolRunning);

  function updateStats(points: [number, number][]) {
    const distanceMeters = routeDistance(points);
    setRouteStats({
      distanceMeters,
      etaSeconds: distanceMeters > 0 ? distanceMeters / (routeSpeedKmh / 3.6) : 0
    });
  }

  function changeTravelMode(nextMode: RouteTravelMode) {
    setRouteTravelMode(nextMode);
    setHistoryOpen(false);
  }

  async function changeLocation() {
    if (mode === "Patrol") {
      if (patrolRunning) {
        setPatrolRunning(false);
        await resetLocation();
        return;
      }
      if (patrolPoints.length >= 2) {
        const nextRoute = closedPatrol(patrolPoints);
        setRoute(nextRoute);
        updateStats(nextRoute);
        setPatrolRunning(true);
        return;
      }
      useGhostStore.setState({ spoofStatus: "Click at least two patrol points" });
      return;
    }

    if (mode === "Route") {
      if (routeRunning) {
        setRoutePaused(!routePaused);
        return;
      }
      if (route.length >= 2) {
        updateStats(route);
        setRouteRunning(true);
        return;
      }
      useGhostStore.setState({ spoofStatus: "Select route start and destination" });
      return;
    }
    await applyCurrentLocation();
  }

  async function stopMovement() {
    if (mode === "Patrol") {
      setPatrolRunning(false);
      useGhostStore.setState({ routeRunning: false, routePaused: false, routeProgress: 0, spoofStatus: "Patrol stopped" });
    } else {
      clearRoute();
      useGhostStore.setState({ spoofStatus: "Route stopped" });
    }
    await resetLocation();
  }

  async function emergencyReset() {
    clearRoute();
    clearPatrol();
    useGhostStore.setState({
      routeRunning: false,
      routePaused: false,
      routeProgress: 0,
      patrolRunning: false,
      randomDrift: false,
      spoofStatus: "Emergency reset..."
    });
    await resetLocation();
    useGhostStore.setState({ spoofStatus: "Returned to real location" });
  }

  function primaryLabel() {
    if (mode === "Patrol") {
      if (patrolRunning) return routePaused ? "Resume Patrol" : "Pause Patrol";
      return patrolPoints.length >= 2 ? "Start Patrol" : "Add Patrol";
    }
    if (mode !== "Route") return "Change Location";
    if (routeRunning) return routePaused ? "Resume Route" : "Pause Route";
    if (route.length >= 2) return "Start Route";
    return "Select Route";
  }

  function exportRoute() {
    const payload = {
      type: mode,
      travelMode: routeTravelMode,
      speedKmh: routeSpeedKmh,
      points: mode === "Patrol" ? patrolPoints : route
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${mode.toLowerCase()}-route.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importRoute(file: File) {
    const body = JSON.parse(await file.text()) as { points?: [number, number][]; route?: [number, number][] };
    const points = body.points ?? body.route ?? [];
    const clean = points.filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
    if (clean.length < 2) {
      useGhostStore.setState({ spoofStatus: "Route file needs at least two points" });
      return;
    }
    setRoute(clean);
    updateStats(clean);
    useGhostStore.setState({ spoofStatus: "Route imported" });
  }

  const statsDistance = routeStats.distanceMeters || routeDistance(mode === "Patrol" ? closedPatrol(patrolPoints) : route);
  const statsEta = statsDistance > 0 ? statsDistance / (routeSpeedKmh / 3.6) : routeStats.etaSeconds;
  const routeToolsVisible = mode === "Route" || mode === "Patrol";

  return (
    <>
      <section className="pointer-events-none fixed bottom-[42px] left-10 right-10 z-40 grid grid-cols-[52px_116px_268px_112px] items-end justify-center gap-3">
        <button className="ghost-liquid liquid-lens pointer-events-auto grid h-[52px] w-[52px] place-items-center rounded-full text-white/85" onClick={onOpenSettings} aria-label="Settings">
          <Settings size={21} />
        </button>

        <div className="pointer-events-auto grid grid-cols-2 gap-3">
          <button className="ghost-liquid liquid-lens grid h-[52px] w-[52px] place-items-center rounded-full text-white/85" onClick={mode === "Static" ? addFavoriteSlot : exportRoute} aria-label={mode === "Static" ? "Save favorite" : "Export route"}>
            {mode === "Static" ? <Heart size={20} /> : <Download size={19} />}
          </button>
          <button className="ghost-liquid liquid-lens grid h-[52px] w-[52px] place-items-center rounded-full text-white/85" onClick={() => setHistoryOpen((open) => !open)} aria-label="Recent locations">
            <Clock3 size={21} />
          </button>
        </div>

        <button className="ghost-liquid liquid-lens pointer-events-auto h-[52px] rounded-full border-black/80 bg-black/35 px-8 text-[18px] font-extrabold tracking-tight text-white shadow-[0_18px_44px_rgba(0,0,0,0.45)]" onClick={changeLocation}>
          {primaryLabel()}
        </button>

        <button className="ghost-liquid liquid-lens pointer-events-auto flex h-[52px] items-center justify-center gap-2 rounded-full border-black/80 px-4 text-[13px] font-extrabold text-white/80" onClick={routeRunning || patrolRunning ? stopMovement : mode === "Patrol" ? clearPatrol : resetLocation}>
          {routeRunning || patrolRunning ? <Square size={15} /> : <RotateCcw size={16} />}
          {routeRunning || patrolRunning ? "Stop" : mode === "Patrol" ? "Clear" : "Reset"}
        </button>
      </section>

      {historyOpen && (
        <div className="ghost-liquid liquid-lens fixed bottom-[116px] left-1/2 z-50 w-[360px] -translate-x-1/2 overflow-hidden rounded-2xl py-2">
          <div className="px-4 py-2 text-xs font-extrabold uppercase text-white/45">Favorites</div>
          {favoriteSlots.length === 0 ? (
            <div className="px-4 pb-3 text-sm text-white/45">Tap the heart to save this spot.</div>
          ) : (
            favoriteSlots.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_36px] items-center">
                <button className="truncate px-4 py-2 text-left text-sm text-white/75 hover:bg-white/5 hover:text-white" onClick={() => loadFavoriteSlot(item)}>
                  {item.name}
                </button>
                <button className="grid h-9 place-items-center text-white/45 hover:text-white" onClick={() => removeFavoriteSlot(item.id)} aria-label="Remove favorite">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
          <div className="mt-1 border-t border-white/10 px-4 py-2 text-xs font-extrabold uppercase text-white/45">Recent</div>
          {recent.length === 0 ? (
            <div className="px-4 py-3 text-sm text-white/50">No recent locations yet.</div>
          ) : (
            recent.map((item) => (
              <button key={item.id} className="block w-full px-4 py-2 text-left text-sm text-white/75 hover:bg-white/5 hover:text-white" onClick={() => loadLocation(item)}>
                {item.name}
              </button>
            ))
          )}
        </div>
      )}

      {routeToolsVisible && (
        <section className="route-tools-panel ghost-liquid liquid-lens fixed bottom-[108px] left-1/2 z-40 flex w-[min(650px,calc(100vw-220px))] min-w-[560px] -translate-x-1/2 items-center justify-center gap-2 rounded-[24px] border-black/80 bg-black/35 p-2 shadow-[0_18px_44px_rgba(0,0,0,0.4)]">
          <div className="grid shrink-0 grid-cols-2 gap-1 rounded-[19px] bg-black/25 p-1">
            <button className={`flex h-9 w-[74px] items-center justify-center gap-1.5 rounded-[15px] text-[11px] font-extrabold transition ${routeTravelMode === "Road" ? "bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" : "text-white/55 hover:text-white"}`} onClick={() => changeTravelMode("Road")}>
              <Car size={15} />
              Road
            </button>
            <button className={`flex h-9 w-[74px] items-center justify-center gap-1.5 rounded-[15px] text-[11px] font-extrabold transition ${routeTravelMode === "Boat" ? "bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" : "text-white/55 hover:text-white"}`} onClick={() => changeTravelMode("Boat")}>
              <Ship size={15} />
              Boat
            </button>
          </div>

          <button
            className={`flex h-9 w-[76px] shrink-0 items-center justify-center gap-1.5 rounded-[16px] text-[11px] font-extrabold transition ${roadSnapEnabled && routeTravelMode === "Road" ? "bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" : "bg-black/20 text-white/55 hover:text-white"}`}
            onClick={() => setRoadSnapEnabled(!roadSnapEnabled)}
            disabled={routeTravelMode === "Boat"}
            aria-label="Toggle smart snap to road"
            title={routeTravelMode === "Boat" ? "Boat mode ignores roads" : "Keep route points locked to real roads"}
          >
            <Lock size={14} />
            Lock
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <span className="w-11 text-right text-[11px] font-extrabold text-white/55">Speed</span>
            <input className="route-speed-slider min-w-0 flex-1" type="range" min="1" max="180" step="1" value={routeSpeedKmh} onChange={(event) => setRouteSpeedKmh(Number(event.target.value))} />
            <span className="w-[70px] text-[13px] font-extrabold tabular-nums text-white">{routeSpeedKmh} km/h</span>
          </div>

          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/25 text-white/75 hover:text-white" onClick={() => setRoutePaused(!routePaused)} disabled={!routeRunning} aria-label="Pause or resume">
            {routePaused ? <Play size={17} /> : <Pause size={17} />}
          </button>
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/25 text-white/75 hover:text-white" onClick={() => importInput.current?.click()} aria-label="Import route">
            <Upload size={17} />
          </button>
          <input ref={importInput} className="hidden" type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void importRoute(event.target.files[0])} />
        </section>
      )}

      {mode === "Patrol" && (
        <div className="ghost-liquid liquid-lens fixed bottom-[174px] left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-extrabold text-white/65">
          Patrol points: {patrolPoints.length} {patrolPoints.length < 2 ? "Click the map to add more" : "Loop ready"}
        </div>
      )}

      <button
        className="ghost-liquid liquid-lens fixed bottom-[50px] right-8 z-50 flex h-[42px] w-[142px] items-center justify-center gap-2 rounded-full border border-yellow-300/45 bg-yellow-500/12 px-4 text-[12px] font-extrabold tracking-tight text-yellow-100 shadow-[0_14px_38px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.2)] hover:border-yellow-200/75 hover:bg-yellow-400/18"
        onClick={emergencyReset}
        aria-label="Emergency return to real location"
      >
        <AlertTriangle size={16} />
        Stop
      </button>
    </>
  );
}
