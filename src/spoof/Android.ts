export type AndroidSpoofTarget = {
  lng: number;
  lat: number;
};

export async function spoofAndroidLocation(target: AndroidSpoofTarget): Promise<void> {
  // TODO: Optional Android support.
  // A real implementation could call ADB or a companion mock-location app:
  // adb shell appops set <package> android:mock_location allow
  // adb shell am broadcast ...
  console.info("[Greenapple spoof stub] Android location target", target);
}
