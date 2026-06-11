export type SpoofTarget = {
  lng: number;
  lat: number;
  name?: string;
};

export async function spoofIOSLocation(target: SpoofTarget): Promise<void> {
  if (window.ghostSpoof?.setIOSLocation) {
    const result = await window.ghostSpoof.setIOSLocation(target);
    if (!result.ok) {
      console.error("[Greenapple spoof] iOS command failed", result);
      throw new Error(result.error || result.stderr || "iOS location command failed");
    }
    return;
  }

  // Browser fallback. The native desktop app exposes ghostSpoof and runs
  // pymobiledevice3 from the Windows host process.
  console.info("[Greenapple spoof stub] iOS location target", target);
}

export async function resetIOSLocation(): Promise<void> {
  if (window.ghostSpoof?.resetIOSLocation) {
    const result = await window.ghostSpoof.resetIOSLocation();
    if (!result.ok) {
      console.error("[Greenapple spoof] iOS reset failed", result);
      throw new Error(result.error || result.stderr || "iOS location reset failed");
    }
    return;
  }

  console.info("[Greenapple spoof stub] iOS reset location");
}

export async function spoofIOSRoute(points: SpoofTarget[], speedKmh: number): Promise<void> {
  if (window.ghostSpoof?.playIOSRoute) {
    const result = await window.ghostSpoof.playIOSRoute({ points, speedKmh });
    if (!result.ok) {
      console.error("[Greenapple spoof] iOS route failed", result);
      throw new Error(result.error || result.stderr || "iOS route command failed");
    }
    return;
  }

  console.info("[Greenapple spoof stub] iOS route target", { points, speedKmh });
}
