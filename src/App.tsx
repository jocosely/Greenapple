import { useEffect, useState } from "react";
import { BottomControls } from "./components/BottomControls";
import { MapView } from "./components/MapView";
import { SettingsModal } from "./components/SettingsModal";
import { TitleBar } from "./components/TitleBar";
import { TopBar } from "./components/TopBar";
import { useGhostStore } from "./store/useGhostStore";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const themeColors = useGhostStore((state) => state.themeColors);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--greenapple-map-bg", themeColors.mapBackground);
    root.style.setProperty("--greenapple-road", themeColors.road);
    root.style.setProperty("--greenapple-label", themeColors.label);
    root.style.setProperty("--greenapple-accent", themeColors.accent);
  }, [themeColors]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-ghost-bg text-white">
      <MapView />
      <TitleBar />
      <TopBar />
      <BottomControls onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
