import { Bluetooth, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GhostMode, useGhostStore } from "../store/useGhostStore";

type MapboxFeature = {
  id: string;
  place_name: string;
  center: [number, number];
};

type NominatimFeature = {
  place_id: number;
  display_name: string;
  lon: string;
  lat: string;
};

function bluetoothErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/globally disabled|not available|not supported|bluetooth.*disabled/i.test(message)) {
    return "Bluetooth is disabled in this browser.";
  }
  if (/user gesture|permission request/i.test(message)) {
    return "Click Connect again to open the Bluetooth picker.";
  }
  if (/cancel|user cancelled|user canceled|no device/i.test(message)) {
    return "Bluetooth connection cancelled.";
  }
  return message || "Bluetooth connection failed.";
}

function connectionLabel(result: { wirelessReady?: boolean; tunnelState?: string; reconnectCount?: number }) {
  if (result.tunnelState === "RECONNECTING") {
    return `Reconnecting${result.reconnectCount ? ` ${result.reconnectCount}` : ""}`;
  }
  if (result.tunnelState === "SPOOFING") return "Spoofing active";
  if (result.tunnelState === "CONNECTING") return "Connecting";
  if (result.tunnelState === "ERROR") return "Connection error";
  return result.wirelessReady ? "Wireless ready" : "USB ready";
}

export function TopBar() {
  const mode = useGhostStore((state) => state.mode);
  const setMode = useGhostStore((state) => state.setMode);
  const setCoords = useGhostStore((state) => state.setCoords);
  const bluetoothName = useGhostStore((state) => state.bluetoothName);
  const bluetoothStatus = useGhostStore((state) => state.bluetoothStatus);
  const setBluetoothState = useGhostStore((state) => state.setBluetoothState);
  const connectionHealth = useGhostStore((state) => state.connectionHealth);
  const setConnectionHealth = useGhostStore((state) => state.setConnectionHealth);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [bluetoothMessage, setBluetoothMessage] = useState("");
  const timer = useRef<number | null>(null);
  const bluetoothTimer = useRef<number | null>(null);
  const hadHealthyConnection = useRef(false);
  const watchdogRetrying = useRef(false);
  const lastWatchdogRetry = useRef(0);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      if (token) {
        const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
        url.searchParams.set("access_token", token);
        url.searchParams.set("limit", "5");
        const response = await fetch(url);
        const body = (await response.json()) as { features?: MapboxFeature[] };
        setResults(body.features ?? []);
        return;
      }

      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "5");
      url.searchParams.set("q", query);
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const body = (await response.json()) as NominatimFeature[];
      setResults(
        body.map((item) => ({
          id: String(item.place_id),
          place_name: item.display_name,
          center: [Number(item.lon), Number(item.lat)]
        }))
      );
    }, 250);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      if (!window.ghostBluetooth?.checkHealth) return;
      const result = await window.ghostBluetooth.checkHealth();
      if (cancelled) return;
      if (result.ok) {
        hadHealthyConnection.current = true;
        watchdogRetrying.current = false;
        const label = connectionLabel(result);
        setConnectionHealth(label);
        if (result.name) setBluetoothState(result.name, label);
      } else {
        const message = result.error || "Disconnected";
        setConnectionHealth(message);
        if (hadHealthyConnection.current) {
          showBluetoothMessage("Connection lost. Auto-retrying now.", 12000);
          const now = Date.now();
          if (!watchdogRetrying.current && now - lastWatchdogRetry.current > 20000) {
            watchdogRetrying.current = true;
            lastWatchdogRetry.current = now;
            try {
              const retry = await window.ghostBluetooth.requestDevice();
              if (cancelled) return;
              if (retry.ok) {
                hadHealthyConnection.current = true;
                const label = connectionLabel(retry);
                setBluetoothState(retry.name || "iPhone", label);
                setConnectionHealth(label);
                showBluetoothMessage("Connection restored.", 5500);
              } else {
                setConnectionHealth(retry.error || message);
                showBluetoothMessage(retry.error || "Auto-retry failed.", 12000);
              }
            } finally {
              watchdogRetrying.current = false;
            }
          }
        }
      }
    }
    void checkHealth();
    const interval = window.setInterval(() => void checkHealth(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [setBluetoothState, setConnectionHealth]);

  async function choose(feature: MapboxFeature) {
    setQuery(feature.place_name);
    setResults([]);
    if (mode === "Route") {
      await setCoords(feature.center, feature.place_name.split(",")[0] || feature.place_name);
      useGhostStore.setState({ spoofStatus: "Click map destination" });
      return;
    }
    await setCoords(feature.center, feature.place_name.split(",")[0] || feature.place_name);
  }

  function showBluetoothMessage(message: string, durationMs = 5500) {
    setBluetoothMessage(message);
    if (bluetoothTimer.current) window.clearTimeout(bluetoothTimer.current);
    bluetoothTimer.current = window.setTimeout(() => setBluetoothMessage(""), durationMs);
  }

  async function connectBluetooth() {
    setBluetoothState("", "Checking Bluetooth...");
    try {
      if (!window.ghostBluetooth?.requestDevice) {
        const message = "Desktop Bluetooth bridge not loaded. Close this app and open the newest Greenapple .exe.";
        setBluetoothState("", message);
        showBluetoothMessage(message, 12000);
        return;
      }

      showBluetoothMessage("Starting iPhone USB/Wi-Fi tunnel. Keep the iPhone unlocked; approve the Windows admin prompt if it appears.", 70000);
      const result = await window.ghostBluetooth.requestDevice();
      if (result.ok) {
        const label = connectionLabel(result);
        setBluetoothState(result.name || "iPhone", label);
        setConnectionHealth(label);
        showBluetoothMessage(
          result.wirelessReady
            ? `Wi-Fi tunnel ready: ${result.name || "iPhone"}`
            : "USB ready. Keep it plugged in until Wi-Fi tunnel ready appears.",
          result.wirelessReady ? 5500 : 12000
        );
        return;
      }
      const message = bluetoothErrorMessage(result.error);
      setBluetoothState("", message);
      setConnectionHealth(message);
      showBluetoothMessage(message);
    } catch (error) {
      const message = bluetoothErrorMessage(error);
      setBluetoothState("", message);
      setConnectionHealth(message);
      showBluetoothMessage(message);
    }
  }

  return (
    <section className="pointer-events-none fixed left-6 right-6 top-[72px] z-40 flex justify-center">
      <div className="pointer-events-auto grid w-full max-w-[1000px] grid-cols-[164px_minmax(340px,500px)_214px] items-start justify-center gap-4">
        <div className="relative">
          <button
            className="ghost-liquid liquid-lens flex h-[44px] w-full items-center justify-center gap-2 rounded-[22px] px-4 text-[12px] font-extrabold text-white"
            onClick={connectBluetooth}
            title={bluetoothStatus}
          >
            <span className={`h-2 w-2 rounded-full ${bluetoothName ? "bg-white shadow-[0_0_16px_rgba(255,255,255,0.5)]" : "bg-white/45"}`} />
            <Bluetooth size={16} strokeWidth={3} className="text-white/80" />
            <span className="truncate">{bluetoothName || "Connect"}</span>
          </button>
          <div className="mt-1 text-center text-[10px] font-extrabold text-white/45">{connectionHealth}</div>
          {bluetoothMessage && (
            <div className="ghost-liquid liquid-lens absolute left-1/2 top-[52px] w-[248px] -translate-x-1/2 rounded-2xl px-3 py-2 text-center text-[11px] font-bold leading-snug text-white/75">
              {bluetoothMessage}
            </div>
          )}
        </div>

        <div className="relative">
        <div className="ghost-liquid liquid-lens flex h-[44px] items-center gap-3 rounded-[22px] px-4">
          <Search size={20} strokeWidth={3} className="text-white/85" />
          <input
            className="h-full flex-1 bg-transparent text-[14px] font-bold text-white outline-none placeholder:text-white/65"
            placeholder="Type an Address or Location"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div className="ghost-liquid liquid-lens mt-2 overflow-hidden rounded-2xl py-2">
            {results.map((feature) => (
              <button
                key={feature.id}
                className="block w-full px-5 py-3 text-left text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
                onClick={() => choose(feature)}
              >
                {feature.place_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ghost-liquid liquid-lens grid h-[44px] w-[214px] grid-cols-3 rounded-[22px] p-[4px]">
        {(["Static", "Route", "Patrol"] as GhostMode[]).map((item) => (
          <button
            key={item}
            className={`rounded-[18px] text-[12px] font-extrabold transition ${mode === item ? "bg-black/65 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-10px_20px_rgba(0,0,0,0.2),0_8px_20px_rgba(0,0,0,0.3)]" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>
      </div>
    </section>
  );
}
