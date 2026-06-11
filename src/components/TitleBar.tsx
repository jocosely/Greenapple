import { Maximize2, Minus, X } from "lucide-react";
import logoUrl from "../assets/greenapple-logo.png";

function fallback(action: "minimize" | "fullscreen" | "close") {
  if (action === "fullscreen") {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
    else void document.exitFullscreen();
  }
  if (action === "close") window.close();
}

export function TitleBar() {
  return (
    <header className="app-drag fixed left-0 right-0 top-0 z-50 h-[58px] border-b border-white/5 bg-gradient-to-b from-[#0d1110]/80 via-[#0b0d0c]/52 to-[#050605]/18 shadow-[0_14px_34px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 select-none items-center gap-2">
        <img
          src={logoUrl}
          alt=""
          className="h-9 w-9 object-contain drop-shadow-[0_0_16px_rgba(0,255,156,0.35)]"
          draggable={false}
        />
        <span className="font-['Palatino_Linotype','Book_Antiqua',Georgia,serif] text-[31px] font-normal italic leading-none text-white drop-shadow-[0_3px_10px_rgba(0,0,0,0.85)]">
          Greenapple
        </span>
      </div>
      <div className="app-no-drag absolute right-5 top-1/2 flex -translate-y-1/2 items-center gap-3">
        <button
          className="ghost-liquid liquid-lens grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:text-white"
          onClick={() => window.ghostWindow?.minimize?.() ?? fallback("minimize")}
          aria-label="Minimize"
        >
          <Minus size={22} strokeWidth={3} />
        </button>
        <button
          className="ghost-liquid liquid-lens grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:text-white"
          onClick={() => window.ghostWindow?.toggleFullscreen?.() ?? fallback("fullscreen")}
          aria-label="Toggle fullscreen"
          title="Fullscreen"
        >
          <Maximize2 size={17} strokeWidth={3} />
        </button>
        <button
          className="ghost-liquid liquid-lens grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:text-white"
          onClick={() => window.ghostWindow?.close?.() ?? fallback("close")}
          aria-label="Close"
        >
          <X size={22} strokeWidth={3} />
        </button>
      </div>
    </header>
  );
}
