import { X } from "lucide-react";
import { useState } from "react";
import { ThemeColors, useGhostStore } from "../store/useGhostStore";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsModal({ open, onClose }: Props) {
  const deviceName = useGhostStore((state) => state.deviceName);
  const setDeviceName = useGhostStore((state) => state.setDeviceName);
  const speed = useGhostStore((state) => state.speed);
  const setSpeed = useGhostStore((state) => state.setSpeed);
  const themeColors = useGhostStore((state) => state.themeColors);
  const setThemeColor = useGhostStore((state) => state.setThemeColor);
  const resetThemeColors = useGhostStore((state) => state.resetThemeColors);
  const randomDrift = useGhostStore((state) => state.randomDrift);
  const setRandomDrift = useGhostStore((state) => state.setRandomDrift);
  const naturalMovement = useGhostStore((state) => state.naturalMovement);
  const setNaturalMovement = useGhostStore((state) => state.setNaturalMovement);
  const savedThemes = useGhostStore((state) => state.savedThemes);
  const saveTheme = useGhostStore((state) => state.saveTheme);
  const applyTheme = useGhostStore((state) => state.applyTheme);
  const removeTheme = useGhostStore((state) => state.removeTheme);
  const connectionHealth = useGhostStore((state) => state.connectionHealth);
  const [themeName, setThemeName] = useState("Custom");

  const colorFields: Array<{ key: keyof ThemeColors; label: string }> = [
    { key: "mapBackground", label: "Map" },
    { key: "road", label: "Roads" },
    { key: "label", label: "Labels" },
    { key: "accent", label: "Accent" }
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/35 p-6 backdrop-blur-[2px]">
      <div className="ghost-panel w-full max-w-md rounded-3xl border-black/80 p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-extrabold">Settings</h2>
          <button className="ghost-liquid liquid-lens grid h-9 w-9 place-items-center rounded-full" onClick={onClose} aria-label="Close settings">
            <X size={20} />
          </button>
        </div>

        <label className="mb-4 block">
          <span className="mb-2 block text-xs font-bold uppercase text-white/50">Device name</span>
          <input className="ghost-liquid liquid-lens w-full rounded-xl border-black/80 bg-black/30 px-3 py-3 outline-none focus:border-white/20" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
        </label>

        <label className="mb-4 block">
          <span className="mb-2 block text-xs font-bold uppercase text-white/50">Spoof speed</span>
          <select className="ghost-liquid liquid-lens w-full rounded-xl border-black/80 bg-black/30 px-3 py-3 outline-none focus:border-white/20" value={speed} onChange={(event) => setSpeed(event.target.value as "Walking" | "Cycling" | "Driving")}>
            <option>Walking</option>
            <option>Cycling</option>
            <option>Driving</option>
          </select>
        </label>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <label className="ghost-liquid liquid-lens flex items-center justify-between rounded-2xl border-black/80 bg-black/30 px-3 py-3">
            <span className="text-sm font-extrabold text-white/70">Random drift</span>
            <input type="checkbox" checked={randomDrift} onChange={(event) => setRandomDrift(event.target.checked)} />
          </label>
          <label className="ghost-liquid liquid-lens flex items-center justify-between rounded-2xl border-black/80 bg-black/30 px-3 py-3">
            <span className="text-sm font-extrabold text-white/70">Natural move</span>
            <input type="checkbox" checked={naturalMovement} onChange={(event) => setNaturalMovement(event.target.checked)} />
          </label>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="block text-xs font-bold uppercase text-white/50">Colors</span>
            <button className="text-xs font-extrabold text-white/55 transition hover:text-white" onClick={resetThemeColors}>
              Reset
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {colorFields.map((field) => (
              <label key={field.key} className="ghost-liquid liquid-lens flex items-center justify-between rounded-2xl border-black/80 bg-black/30 px-3 py-2">
                <span className="text-sm font-extrabold text-white/70">{field.label}</span>
                <input className="h-9 w-12 cursor-pointer rounded-xl border-0 bg-transparent p-0" type="color" value={themeColors[field.key]} onChange={(event) => setThemeColor(field.key, event.target.value)} aria-label={`${field.label} color`} />
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="block text-xs font-bold uppercase text-white/50">Map themes</span>
            <button className="text-xs font-extrabold text-white/55 transition hover:text-white" onClick={() => saveTheme(themeName)}>
              Save
            </button>
          </div>
          <input className="ghost-liquid liquid-lens mb-2 w-full rounded-xl border-black/80 bg-black/30 px-3 py-2 text-sm font-bold outline-none focus:border-white/20" value={themeName} onChange={(event) => setThemeName(event.target.value)} />
          <div className="max-h-28 overflow-auto rounded-2xl bg-black/20">
            {savedThemes.length === 0 ? (
              <div className="px-3 py-3 text-sm text-white/45">No saved themes yet.</div>
            ) : (
              savedThemes.map((theme) => (
                <div key={theme.id} className="grid grid-cols-[1fr_34px] items-center">
                  <button className="px-3 py-2 text-left text-sm font-bold text-white/70 hover:bg-white/5 hover:text-white" onClick={() => applyTheme(theme)}>
                    {theme.name}
                  </button>
                  <button className="grid h-8 place-items-center text-white/40 hover:text-white" onClick={() => removeTheme(theme.id)} aria-label="Remove theme">
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ghost-liquid liquid-lens rounded-2xl border-black/80 bg-black/30 p-4 text-sm text-white/60">
          Connection health: {connectionHealth}
        </div>
      </div>
    </div>
  );
}
