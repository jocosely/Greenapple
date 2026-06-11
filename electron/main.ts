import { app, BrowserWindow, ipcMain, shell } from "electron";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import isDev from "electron-is-dev";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const tunnelPort = 49151;
let activeLocationSession: ChildProcessWithoutNullStreams | null = null;
type TunnelState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "SPOOFING" | "RECONNECTING" | "ERROR";
let tunnelState: TunnelState = "DISCONNECTED";
let activeLocationHold: {
  commandSets: string[][];
  stopped: boolean;
  target?: SpoofTarget;
  refreshTimer?: NodeJS.Timeout;
  watchdogTimer?: NodeJS.Timeout;
  reconnectCount: number;
  lastError?: string;
} | null = null;
app.commandLine.appendSwitch("enable-web-bluetooth");
app.commandLine.appendSwitch("enable-experimental-web-platform-features");
app.commandLine.appendSwitch("enable-features", "WebBluetooth,WebBluetoothNewPermissionsBackend");

type SpoofTarget = {
  lng: number;
  lat: number;
  name?: string;
};

type RouteTarget = {
  points: SpoofTarget[];
  speedKmh: number;
};

type BluetoothDeviceInfo = {
  name: string;
  status: string;
};

type WindowsBluetoothScan = {
  phone: BluetoothDeviceInfo | null;
  devices: BluetoothDeviceInfo[];
};

type IPhoneConnectionResult = {
  ok: boolean;
  name?: string;
  id?: string;
  wirelessReady?: boolean;
  tunnelState?: TunnelState;
  reconnectCount?: number;
  error?: string;
  stdout?: string;
};

function workspaceRoot() {
  return path.resolve(__dirname, "..", "..");
}

function candidateRoots() {
  const roots = [
    process.env.GREENAPPLE_ROOT,
    workspaceRoot(),
    process.cwd(),
    process.resourcesPath,
    path.dirname(app.getPath("exe")),
    path.resolve(path.dirname(app.getPath("exe")), ".."),
    path.resolve(path.dirname(app.getPath("exe")), "..", ".."),
    path.resolve(app.getPath("userData"), "..", "..")
  ].filter(Boolean) as string[];
  return [...new Set(roots)];
}

function pythonCandidates() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const localCandidates = candidateRoots().flatMap((root) => [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, "greenapple", ".venv", "Scripts", "python.exe"),
    path.join(root, "work", "greenapple", ".venv", "Scripts", "python.exe")
  ]);
  const versionedCandidates = [
    path.join(localAppData, "Programs", "Python", "Python313", "python.exe"),
    path.join(localAppData, "Programs", "Python", "Python312", "python.exe"),
    path.join(localAppData, "Programs", "Python", "Python311", "python.exe"),
    path.join(localAppData, "Programs", "Python", "Python310", "python.exe")
  ];
  return [process.env.GREENAPPLE_PYTHON, ...versionedCandidates, ...localCandidates, "python"].filter(Boolean) as string[];
}

function resolvePython() {
  for (const candidate of pythonCandidates()) {
    if (candidate === "python" || fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

function tunnelPythonCandidates() {
  const localAppData = process.env.LOCALAPPDATA || "";
  return [
    process.env.GREENAPPLE_TUNNEL_PYTHON,
    path.join(localAppData, "Programs", "Python", "Python313", "python.exe"),
    ...pythonCandidates()
  ].filter(Boolean) as string[];
}

function resolveTunnelPython() {
  for (const candidate of tunnelPythonCandidates()) {
    if (candidate === "python" || fs.existsSync(candidate)) return candidate;
  }
  return resolvePython();
}

function friendlyCommandError(error: Error & { stdout?: string; stderr?: string; cmd?: string }) {
  const details = [error.message, error.stderr, error.stdout].filter(Boolean).join(" ").replace(/\u001b\[[0-9;]*m/g, "");
  if (/No module named pymobiledevice3/i.test(details)) {
    return "iPhone tools are missing. Install pymobiledevice3 or set GREENAPPLE_PYTHON to the Python environment that has it.";
  }
  if (/DeveloperDiskImage|Developer Mode|start-tunnel|tunneld|RemoteServiceDiscovery|DVT/i.test(details)) {
    return "iPhone developer connection is not ready. Unlock the phone, enable Developer Mode, trust this PC, then reconnect.";
  }
  if (/No such file|not recognized|cannot find/i.test(details)) {
    return "Python/iPhone tools were not found. Set GREENAPPLE_PYTHON to a Python that has pymobiledevice3 installed.";
  }
  if (/password protected|unlock/i.test(details)) {
    return "Unlock the iPhone, keep it on the Home Screen, then click Connect again.";
  }
  if (/No device|no devices|Device is not connected|not connected|usbmux|lockdown|pair/i.test(details)) {
    return "No trusted iPhone detected. Plug in with USB, unlock it, tap Trust, and enable Developer Mode.";
  }
  return error.stderr || error.message || "iPhone command failed.";
}

function commandOutputHasError(stdout = "", stderr = "") {
  const details = [stdout, stderr].join(" ").replace(/\u001b\[[0-9;]*m/g, "");
  return /\bERROR\b|Device is not connected|No device|no devices|not connected|password protected|unlock|lockdown|pair/i.test(details);
}

function execFileWithInput(
  file: string,
  args: string[],
  options: { cwd?: string; timeout?: number; windowsHide?: boolean } = {},
  input = "\n"
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function stopActiveLocationSession(clearPersistedLocation = true) {
  if (activeLocationHold?.refreshTimer) clearTimeout(activeLocationHold.refreshTimer);
  if (activeLocationHold?.watchdogTimer) clearTimeout(activeLocationHold.watchdogTimer);
  activeLocationHold = null;
  tunnelState = "DISCONNECTED";
  if (clearPersistedLocation) clearHeldLocation();
  const session = activeLocationSession;
  activeLocationSession = null;
  if (!session || session.killed) return;
  try {
    session.stdin.write("\n");
    session.stdin.end();
  } catch {
    // The process may already be gone.
  }
  await Promise.race([
    new Promise((resolve) => session.once("exit", resolve)),
    delay(2500).then(() => {
      if (!session.killed) session.kill();
    })
  ]);
}

async function stopLocationProcessOnly() {
  const session = activeLocationSession;
  activeLocationSession = null;
  if (!session || session.killed) return;
  try {
    session.stdin.write("\n");
    session.stdin.end();
  } catch {
    // The process may already be gone.
  }
  await Promise.race([
    new Promise((resolve) => session.once("exit", resolve)),
    delay(1500).then(() => {
      if (!session.killed) session.kill();
    })
  ]);
}

function runPersistentLocationSession(python: string, args: string[], timeout = 60000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: workspaceRoot(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const startedAt = Date.now();
    const timer = windowlessTimeout(timeout, () => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(Object.assign(new Error("Timed out while starting iPhone location session."), { stdout, stderr }));
      }
    });

    function maybeReady() {
      if (settled) return;
      const output = `${stdout} ${stderr}`;
      if (commandOutputHasError(stdout, stderr)) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(Object.assign(new Error(stderr || stdout || "iPhone command failed."), { stdout, stderr }));
        return;
      }
      if (/Press ENTER to exit>/i.test(output) || Date.now() - startedAt > 3500) {
        settled = true;
        clearTimeout(timer);
        activeLocationSession = child;
        watchLocationSession(child);
        resolve({ stdout, stderr });
      }
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      maybeReady();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      maybeReady();
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(Object.assign(error, { stdout, stderr }));
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const message = code === 0 ? "iPhone location session ended before it could stay active." : `iPhone location command exited with code ${code}.`;
        reject(Object.assign(new Error(message), { stdout, stderr }));
      }
    });
  });
}

async function startHeldLocation(commandSets: string[][], timeout = 60000, target?: SpoofTarget) {
  if (target) saveHeldLocation(target);
  activeLocationHold = { commandSets, stopped: false, target, reconnectCount: 0 };
  tunnelState = "CONNECTING";
  scheduleHeldLocationWatchdog(500);
  return await restartHeldLocation(timeout);
}

async function restartHeldLocation(timeout = 60000) {
  const hold = activeLocationHold;
  if (!hold || hold.stopped) throw new Error("No active location hold.");
  await stopLocationProcessOnly();
  tunnelState = hold.reconnectCount > 0 ? "RECONNECTING" : "CONNECTING";
  const result = await runSinglePymobiledeviceAttempt(hold.commandSets, timeout, true);
  if (result.ok) {
    tunnelState = "SPOOFING";
    hold.lastError = undefined;
  } else {
    tunnelState = "RECONNECTING";
    hold.lastError = result.error || result.stderr || "Location re-push failed";
  }
  scheduleHeldLocationRefresh();
  scheduleHeldLocationWatchdog(2000);
  return result;
}

function scheduleHeldLocationRefresh() {
  const hold = activeLocationHold;
  if (!hold || hold.stopped) return;
  if (hold.refreshTimer) clearTimeout(hold.refreshTimer);
  hold.refreshTimer = setTimeout(() => {
    const current = activeLocationHold;
    if (!current || current.stopped) return;
    restartHeldLocation(60000).catch(() => {
      scheduleHeldLocationRefresh();
    });
  }, 120000);
}

function scheduleHeldLocationWatchdog(delayMs = 2000) {
  const hold = activeLocationHold;
  if (!hold || hold.stopped) return;
  if (hold.watchdogTimer) clearTimeout(hold.watchdogTimer);
  hold.watchdogTimer = setTimeout(() => {
    void runHeldLocationWatchdog();
  }, delayMs);
}

async function runHeldLocationWatchdog() {
  const hold = activeLocationHold;
  if (!hold || hold.stopped) return;

  const ready = await canUseDeveloperTunnel(5500);
  let tunnelReady = ready;
  if (!tunnelReady) {
    try {
      await ensureTunnel();
      tunnelReady = await canUseDeveloperTunnel(8000);
    } catch {
      tunnelReady = false;
    }
  }

  if (!tunnelReady) {
    hold.reconnectCount += 1;
    tunnelState = "RECONNECTING";
    hold.lastError = "Tunnel dropped. Waiting for iPhone to wake or network to reconnect.";
    await stopLocationProcessOnly();
    scheduleHeldLocationWatchdog(2000);
    return;
  }

  if (!activeLocationSession || activeLocationSession.killed || tunnelState === "RECONNECTING" || tunnelState === "CONNECTING") {
    tunnelState = "CONNECTED";
    try {
      await restartHeldLocation(60000);
      if (activeLocationHold) activeLocationHold.reconnectCount = 0;
    } catch (error) {
      if (activeLocationHold) {
        activeLocationHold.reconnectCount += 1;
        activeLocationHold.lastError = error instanceof Error ? error.message : "Reconnect failed";
      }
      tunnelState = "RECONNECTING";
      scheduleHeldLocationWatchdog(2000);
    }
    return;
  }

  tunnelState = "SPOOFING";
  scheduleHeldLocationWatchdog(2000);
}

async function resumePersistedLocationIfReady() {
  if (activeLocationHold && !activeLocationHold.stopped) return false;
  const target = readHeldLocation();
  if (!target) return false;
  if (!(await canUseDeveloperTunnel(8000))) return false;
  const commandSets = locationCommandSets(target);
  const result = await startHeldLocation(commandSets, 60000, target);
  return result.ok;
}

function watchLocationSession(child: ChildProcessWithoutNullStreams) {
  child.once("exit", () => {
    if (activeLocationSession === child) activeLocationSession = null;
    const hold = activeLocationHold;
    if (!hold || hold.stopped) return;
    if (hold.refreshTimer) clearTimeout(hold.refreshTimer);
    tunnelState = "RECONNECTING";
    hold.reconnectCount += 1;
    hold.lastError = "Location session ended. Waiting for tunnel reconnect.";
    scheduleHeldLocationWatchdog(1000);
  });
}

function windowlessTimeout(ms: number, callback: () => void) {
  return setTimeout(callback, ms);
}

function tunneldLogPath() {
  return path.join(app.getPath("userData"), "tunneld.log");
}

function heldLocationPath() {
  return path.join(app.getPath("userData"), "held-location.json");
}

function saveHeldLocation(target: SpoofTarget) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(heldLocationPath(), JSON.stringify(target, null, 2), "utf8");
}

function readHeldLocation() {
  try {
    const file = heldLocationPath();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SpoofTarget;
    validateCoordinate(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function clearHeldLocation() {
  try {
    const file = heldLocationPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // Best-effort cleanup only.
  }
}

function locationCommandSets(target: SpoofTarget) {
  const lat = target.lat.toFixed(7);
  const lng = target.lng.toFixed(7);
  return [
    ["developer", "dvt", "simulate-location", "set", "--", lat, lng],
    ["developer", "simulate-location", "set", "--", lat, lng]
  ];
}

async function isTunneldListening() {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `if (Get-NetTCPConnection -LocalPort ${tunnelPort} -State Listen -ErrorAction SilentlyContinue) { 'yes' }`
      ],
      { timeout: 5000, windowsHide: true }
    );
    return stdout.trim() === "yes";
  } catch {
    return false;
  }
}

function parseRsdEndpoint(text: string) {
  const match = text.match(/--rsd\s+([^\s]+)\s+(\d+)/i);
  if (!match) return null;
  return { host: match[1], port: match[2] };
}

async function readRsdEndpoint() {
  const serverEndpoint = await readRsdEndpointFromServer();
  if (serverEndpoint) return serverEndpoint;
  const logPath = tunneldLogPath();
  if (!fs.existsSync(logPath)) return null;
  return parseRsdEndpoint(fs.readFileSync(logPath, "utf8"));
}

function readRsdEndpointFromServer() {
  return new Promise<{ host: string; port: string } | null>((resolve) => {
    const request = http.get(`http://127.0.0.1:${tunnelPort}/`, { timeout: 3000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body) as Record<string, Array<{ "tunnel-address"?: string; "tunnel-port"?: number }>>;
          const first = Object.values(parsed).flat()[0];
          if (first?.["tunnel-address"] && first?.["tunnel-port"]) {
            resolve({ host: first["tunnel-address"], port: String(first["tunnel-port"]) });
            return;
          }
        } catch {
          // Fall back to log parsing below.
        }
        resolve(null);
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}

async function startElevatedTunneld() {
  const python = resolveTunnelPython();
  const logPath = tunneldLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const command = `& '${python.replace(/'/g, "''")}' -m pymobiledevice3 remote tunneld --protocol tcp --host 127.0.0.1 --port ${tunnelPort} *> '${logPath.replace(/'/g, "''")}'`;
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command','${command.replace(/'/g, "''")}') -Verb RunAs -WindowStyle Hidden`
    ],
    { timeout: 10000, windowsHide: true }
  );
}

async function canUseDeveloperTunnel(timeout = 20000) {
  try {
    const python = resolveTunnelPython();
    const { stdout, stderr } = await execFileAsync(
      python,
      ["-m", "pymobiledevice3", "developer", "dvt", "ls", "/", "--tunnel", ""],
      {
        cwd: workspaceRoot(),
        timeout,
        windowsHide: true
      }
    );
    return !commandOutputHasError(stdout, stderr);
  } catch {
    return false;
  }
}

async function ensureTunnel() {
  let endpoint = await readRsdEndpoint();
  if (endpoint && (await isTunneldListening())) return endpoint;

  if (!(await isTunneldListening())) {
    await startElevatedTunneld();
  }

  for (let index = 0; index < 30; index += 1) {
    await delay(1000);
    endpoint = await readRsdEndpoint();
    if (endpoint && (await isTunneldListening())) return endpoint;
  }

  throw new Error("iOS tunnel is not running. Approve the Windows administrator prompt, keep the iPhone unlocked, then try Change Location again.");
}

function validateCoordinate(target: SpoofTarget) {
  if (!Number.isFinite(target.lat) || target.lat < -90 || target.lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(target.lng) || target.lng < -180 || target.lng > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }
}

function validateRoute(route: RouteTarget) {
  if (!Array.isArray(route.points) || route.points.length < 2) {
    throw new Error("Route needs a start and destination.");
  }
  for (const point of route.points) validateCoordinate(point);
}

function routeGpx(route: RouteTarget) {
  const now = new Date();
  const secondsPerPoint = Math.max(3, Math.round(3600 / Math.max(1, route.speedKmh)));
  const points = route.points
    .map((point, index) => {
      const time = new Date(now.getTime() + index * secondsPerPoint * 1000).toISOString();
      return `    <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}"><time>${time}</time></trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Greenapple" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Greenapple Route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

async function runSinglePymobiledeviceAttempt(commandSets: string[][], timeout = 60000, keepAlive = false) {
  const python = resolveTunnelPython();
  let lastError: (Error & { stdout?: string; stderr?: string; cmd?: string }) | undefined;
  let rsd: { host: string; port: string } | null = null;
  let tunnelReady = false;

  try {
    rsd = await ensureTunnel();
    tunnelReady = true;
  } catch (error) {
    lastError = error as Error & { stdout?: string; stderr?: string; cmd?: string };
    tunnelReady = await canUseDeveloperTunnel(8000);
  }

  for (const commandSet of commandSets) {
    const usesDvtLocation =
      commandSet[0] === "developer" &&
      commandSet[1] === "dvt" &&
      commandSet[2] === "simulate-location" &&
      (tunnelReady || !!rsd);
    const endpoint = rsd;
    const tunnelArgs = endpoint ? ["--rsd", endpoint.host, endpoint.port] : ["--tunnel", ""];
    const args = [
      "-m",
      "pymobiledevice3",
      ...commandSet.slice(0, usesDvtLocation ? 4 : commandSet.length),
      ...(usesDvtLocation ? [...tunnelArgs, ...commandSet.slice(4)] : [])
    ];
    try {
      const { stdout, stderr } = keepAlive
        ? await runPersistentLocationSession(python, args, timeout)
        : await execFileWithInput(python, args, {
            cwd: workspaceRoot(),
            timeout,
            windowsHide: true
          });
      if (commandOutputHasError(stdout, stderr)) {
        throw Object.assign(new Error(stderr || stdout || "iPhone command failed."), {
          stdout,
          stderr,
          cmd: [python, ...args].join(" ")
        });
      }
      return {
        ok: true,
        command: [python, ...args],
        stdout,
        stderr
      };
    } catch (error) {
      lastError = error as Error & { stdout?: string; stderr?: string; cmd?: string };
      const details = [lastError.message, lastError.stderr, lastError.stdout].filter(Boolean).join(" ");
      if (/No module named pymobiledevice3|No such file|not recognized|cannot find/i.test(details)) break;
    }
  }

  const err = (lastError ?? new Error("iPhone command failed.")) as Error & {
    stdout?: string;
    stderr?: string;
    cmd?: string;
  };
  return {
    ok: false,
    command: err.cmd ? [err.cmd] : [],
    stdout: err.stdout ?? "",
    stderr: err.stderr ?? "",
    error: friendlyCommandError(err)
  };
}

async function runPymobiledeviceCommand(commandSets: string[][], timeout = 60000, keepAlive = false, target?: SpoofTarget) {
  if (keepAlive) return await startHeldLocation(commandSets, timeout, target);
  return await runSinglePymobiledeviceAttempt(commandSets, timeout, false);
}

function deviceDisplayName(device: Record<string, unknown>, index: number) {
  const name =
    device.DeviceName ||
    device.device_name ||
    device.Name ||
    device.ProductType ||
    device.product_type ||
    device.Identifier ||
    device.SerialNumber ||
    device.UniqueDeviceID ||
    device.udid;
  return typeof name === "string" && name.trim() ? name : `iPhone ${index + 1}`;
}

function deviceIdentifier(device: Record<string, unknown>) {
  const id = device.Identifier || device.SerialNumber || device.UniqueDeviceID || device.udid || device.DeviceID;
  return typeof id === "string" ? id : "";
}

async function enableIPhoneWifiConnections() {
  try {
    const python = resolveTunnelPython();
    const { stdout, stderr } = await execFileAsync(
      python,
      ["-m", "pymobiledevice3", "lockdown", "wifi-connections", "--state", "on"],
      {
        cwd: workspaceRoot(),
        timeout: 20000,
        windowsHide: true
      }
    );
    return !commandOutputHasError(stdout, stderr);
  } catch {
    return false;
  }
}

async function pairIPhoneForWireless() {
  try {
    const python = resolveTunnelPython();
    const { stdout, stderr } = await execFileAsync(python, ["-m", "pymobiledevice3", "lockdown", "pair"], {
      cwd: workspaceRoot(),
      timeout: 30000,
      windowsHide: true
    });
    const details = `${stdout} ${stderr}`;
    return !commandOutputHasError(stdout, stderr) || /already paired|paired/i.test(details);
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const details = [err.message, err.stderr, err.stdout].filter(Boolean).join(" ");
    return /already paired|paired/i.test(details);
  }
}

async function isIPhoneVisibleOverWifi() {
  try {
    const python = resolveTunnelPython();
    const { stdout, stderr } = await execFileAsync(python, ["-m", "pymobiledevice3", "remote", "browse"], {
      cwd: workspaceRoot(),
      timeout: 20000,
      windowsHide: true
    });
    if (commandOutputHasError(stdout, stderr)) return false;
    const parsed = JSON.parse(stdout || "{}") as { wifi?: unknown[] };
    return Array.isArray(parsed.wifi) && parsed.wifi.length > 0;
  } catch {
    return false;
  }
}

async function waitForIPhoneWifiVisibility(timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isIPhoneVisibleOverWifi()) return true;
    await delay(3000);
  }
  return false;
}

async function connectIPhoneDevice(): Promise<IPhoneConnectionResult> {
  try {
    if (await canUseDeveloperTunnel(12000)) {
      const resumed = await resumePersistedLocationIfReady();
      return {
        ok: true,
        name: "iPhone",
        wirelessReady: true,
        tunnelState,
        reconnectCount: activeLocationHold?.reconnectCount ?? 0,
        stdout: resumed ? "Wi-Fi developer tunnel ready. Last location re-pushed." : "Existing Wi-Fi developer tunnel is ready."
      };
    }

    const python = resolveTunnelPython();
    const { stdout, stderr } = await execFileAsync(python, ["-m", "pymobiledevice3", "usbmux", "list"], {
      cwd: workspaceRoot(),
      timeout: 20000,
      windowsHide: true
    });
    if (commandOutputHasError(stdout, stderr)) {
      throw Object.assign(new Error(stderr || stdout || "Could not check iPhone connection."), { stdout, stderr });
    }
    const output = stdout.trim();
    const devices = output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
    if (Array.isArray(devices) && devices.length > 0) {
      const device = devices[0];
      const paired = await pairIPhoneForWireless();
      const wifiEnabled = await enableIPhoneWifiConnections();
      let wirelessReady = false;
      if (wifiEnabled) {
        try {
          await ensureTunnel();
          wirelessReady = await canUseDeveloperTunnel(20000);
        } catch {
          wirelessReady = await waitForIPhoneWifiVisibility(60000);
        }
      }
      return {
        ok: true,
        name: deviceDisplayName(device, 0),
        id: deviceIdentifier(device),
        wirelessReady,
        tunnelState: wirelessReady ? tunnelState : "CONNECTED",
        reconnectCount: activeLocationHold?.reconnectCount ?? 0,
        stdout: [
          stdout,
          paired ? "Pairing ready." : "Pairing did not complete; unlock the iPhone and click Connect again.",
          wifiEnabled ? "Wi-Fi connections enabled." : "Wi-Fi connections did not enable.",
          wirelessReady ? "Wi-Fi developer tunnel ready." : "Wi-Fi developer tunnel not ready yet."
        ].join("\n")
      };
    }

    try {
      await ensureTunnel();
      if (await canUseDeveloperTunnel(20000)) {
        const resumed = await resumePersistedLocationIfReady();
        return {
          ok: true,
          name: "iPhone",
          wirelessReady: true,
          tunnelState,
          reconnectCount: activeLocationHold?.reconnectCount ?? 0,
          stdout: resumed ? "Wi-Fi developer tunnel ready. Last location re-pushed." : "Wi-Fi developer tunnel ready."
        };
      }
    } catch {
      // Return the clearer USB setup message below.
    }

    return {
      ok: false,
      stdout,
      error: "No iPhone developer connection found. Bluetooth can pair the phone, but location changing needs Apple Mobile Device / usbmux. Plug in with USB, unlock it, tap Trust, then click Connect again."
    };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const details = [err.message, err.stderr, err.stdout].filter(Boolean).join(" ");
    if (/No module named pymobiledevice3/i.test(details)) {
      return {
        ok: false,
        error: "pymobiledevice3 is not installed for the selected Python. Install it or set GREENAPPLE_PYTHON to the Python environment that has it."
      };
    }
    return {
      ok: false,
      stdout: err.stdout,
      error: friendlyCommandError(Object.assign(new Error(details || "Could not check iPhone connection."), err))
    };
  }
}

async function checkIPhoneHealth(): Promise<IPhoneConnectionResult> {
  try {
    if (await canUseDeveloperTunnel(8000)) {
      const resumed = await resumePersistedLocationIfReady();
      return {
        ok: true,
        name: "iPhone",
        wirelessReady: true,
        tunnelState,
        reconnectCount: activeLocationHold?.reconnectCount ?? 0,
        stdout: resumed ? "Wi-Fi developer tunnel ready. Last location re-pushed." : "Wi-Fi developer tunnel ready."
      };
    }

    const python = resolveTunnelPython();
    const { stdout, stderr } = await execFileAsync(python, ["-m", "pymobiledevice3", "usbmux", "list"], {
      cwd: workspaceRoot(),
      timeout: 12000,
      windowsHide: true
    });
    if (commandOutputHasError(stdout, stderr)) {
      throw Object.assign(new Error(stderr || stdout || "Could not check iPhone connection."), { stdout, stderr });
    }
    const output = stdout.trim();
    const devices = output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
    if (Array.isArray(devices) && devices.length > 0) {
      return {
        ok: true,
        name: deviceDisplayName(devices[0], 0),
        id: deviceIdentifier(devices[0]),
        wirelessReady: await isIPhoneVisibleOverWifi(),
        tunnelState: activeLocationHold ? tunnelState : "CONNECTED",
        reconnectCount: activeLocationHold?.reconnectCount ?? 0,
        stdout
      };
    }
    return { ok: false, stdout, tunnelState: activeLocationHold ? tunnelState : "DISCONNECTED", reconnectCount: activeLocationHold?.reconnectCount ?? 0, error: activeLocationHold?.lastError || "No trusted iPhone detected." };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: err.stdout,
      tunnelState: activeLocationHold ? tunnelState : "DISCONNECTED",
      reconnectCount: activeLocationHold?.reconnectCount ?? 0,
      error: friendlyCommandError(Object.assign(new Error(err.message || "Health check failed."), err))
    };
  }
}

async function findWindowsBluetoothDevice(): Promise<BluetoothDeviceInfo | null> {
  return (await scanWindowsBluetooth()).phone;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWindowsBluetoothPhone(timeoutMs: number): Promise<WindowsBluetoothScan> {
  const started = Date.now();
  let latest: WindowsBluetoothScan = { phone: null, devices: [] };
  while (Date.now() - started < timeoutMs) {
    latest = await scanWindowsBluetooth();
    if (latest.phone) return latest;
    await delay(2000);
  }
  return latest;
}

async function scanWindowsBluetooth(): Promise<WindowsBluetoothScan> {
  if (process.platform !== "win32") return { phone: null, devices: [] };

  const script = `
    $items = @()

    $items += Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |
      Where-Object { $_.FriendlyName } |
      ForEach-Object {
        [pscustomobject]@{
          FriendlyName = $_.FriendlyName
          Status = [string]$_.Status
          Source = 'PnP'
          Id = [string]$_.InstanceId
        }
      }

    $items += Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
      Where-Object {
        ($_.PNPClass -eq 'Bluetooth' -or $_.DeviceID -like 'BTH*') -and $_.Name
      } |
      ForEach-Object {
        [pscustomobject]@{
          FriendlyName = $_.Name
          Status = if ($_.Status) { [string]$_.Status } else { 'Unknown' }
          Source = 'WMI'
          Id = [string]$_.DeviceID
        }
      }

    $regRoot = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices'
    if (Test-Path $regRoot) {
      Get-ChildItem $regRoot -ErrorAction SilentlyContinue | ForEach-Object {
        $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        $name = $null
        if ($props -and $props.Name) {
          if ($props.Name -is [byte[]]) {
            $raw = [byte[]]$props.Name
            $decoded = [System.Text.Encoding]::Unicode.GetString($raw).Trim([char]0)
            if (-not $decoded.Trim() -or $decoded -match '[^ -~]') {
              $decoded = [System.Text.Encoding]::ASCII.GetString($raw).Trim([char]0)
            }
            $name = $decoded
          } else {
            $name = [string]$props.Name
          }
        }
        if ($name) {
          [pscustomobject]@{
            FriendlyName = $name
            Status = 'Paired'
            Source = 'Registry'
            Id = [string]$_.PSChildName
          }
        }
      } | ForEach-Object { $items += $_ }
    }

    $items |
      Where-Object { $_.FriendlyName } |
      Sort-Object FriendlyName, Id -Unique |
      ConvertTo-Json -Compress
  `;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 10000,
    windowsHide: true
  });
  const trimmed = stdout.trim();
  if (!trimmed) return { phone: null, devices: [] };
  const parsed = JSON.parse(trimmed) as
    | Array<{ FriendlyName?: string; Status?: string; Source?: string; Id?: string }>
    | { FriendlyName?: string; Status?: string; Source?: string; Id?: string };
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const devices = records
    .filter((record) => record.FriendlyName)
    .map((record) => ({
      name: record.FriendlyName || "Bluetooth device",
      status: [record.Status || "Unknown", record.Source, record.Id].filter(Boolean).join(" · ")
    }));
  const phone =
    devices.find(
      (device) =>
        /iphone|ios|phone|apple mobile/i.test(device.name) &&
        !/airpods|adapter|enumerator|rfcomm|protocol|transport|service/i.test(device.name)
    ) ?? null;
  return { phone, devices };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: "#0D0D0D",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      experimentalFeatures: true
    }
  });

  win.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    const preferred = deviceList.find((device) => /iphone|ios|apple/i.test(device.deviceName));
    const selected = preferred ?? deviceList[0];
    callback(selected?.deviceId ?? "");
  });

  win.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return ["bluetooth", "bluetoothScanning"].includes(permission);
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["bluetooth", "bluetoothScanning"].includes(permission));
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer gone]", details);
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[renderer load failed]", errorCode, errorDescription, validatedURL);
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:8765");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  if (process.env.GREENAPPLE_DEBUG_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("spoof:ios:set-location", async (_event, target: SpoofTarget) => {
    try {
      validateCoordinate(target);
      return await runPymobiledeviceCommand(locationCommandSets(target), 60000, true, target);
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; cmd?: string };
      return {
        ok: false,
        command: err.cmd ? [err.cmd] : [],
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        error: friendlyCommandError(err)
      };
    }
  });

  ipcMain.handle("spoof:ios:reset-location", async () => {
    try {
      await stopActiveLocationSession();
      return await runPymobiledeviceCommand([
        ["developer", "dvt", "simulate-location", "clear"],
        ["developer", "simulate-location", "clear"]
      ]);
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; cmd?: string };
      return {
        ok: false,
        command: err.cmd ? [err.cmd] : [],
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        error: friendlyCommandError(err)
      };
    }
  });

  ipcMain.handle("spoof:ios:play-route", async (_event, route: RouteTarget) => {
    try {
      validateRoute(route);
      await stopActiveLocationSession();
      const gpxPath = path.join(app.getPath("temp"), `greenapple-route-${Date.now()}.gpx`);
      fs.writeFileSync(gpxPath, routeGpx(route), "utf8");
      return await runPymobiledeviceCommand([
        ["developer", "dvt", "simulate-location", "play", gpxPath],
        ["developer", "simulate-location", "play", gpxPath]
      ]);
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; cmd?: string };
      return {
        ok: false,
        command: err.cmd ? [err.cmd] : [],
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        error: friendlyCommandError(err)
      };
    }
  });

  ipcMain.handle("bluetooth:request-device", async (event) => {
    try {
      const iphone = await connectIPhoneDevice();
      if (iphone.ok) return iphone;
      const firstScan = await scanWindowsBluetooth();

      if (process.platform === "win32") {
        if (!firstScan.phone) await shell.openExternal("ms-settings:bluetooth");
        const pairedScan = firstScan.phone ? firstScan : await waitForWindowsBluetoothPhone(60000);
        const retryIphone = await connectIPhoneDevice();
        if (retryIphone.ok) return retryIphone;
        const found = pairedScan.devices.map((device) => device.name).filter(Boolean);
        const bluetoothPart = pairedScan.phone
          ? `${pairedScan.phone.name} is paired over Bluetooth, but Bluetooth cannot send iOS developer location commands.`
          : found.length > 0
            ? `Windows Bluetooth sees: ${found.join(", ")}.`
            : "Windows Bluetooth does not see an iPhone.";
        return {
          ok: false,
          devices: pairedScan.devices,
          error: `${bluetoothPart} ${retryIphone.error || iphone.error || "Plug in with USB, unlock, tap Trust, enable Developer Mode, then click Connect again."}`
        };
      }
      return {
        ok: false,
        devices: firstScan.devices,
        error: iphone.error || "No iPhone developer connection found."
      };
    } catch (error) {
      return {
        ok: false,
        devices: [],
        error: error instanceof Error ? error.message : "Pair your iPhone in Windows Bluetooth settings, then click Connect again."
      };
    }
  });

  ipcMain.handle("bluetooth:check-health", async () => {
    return await checkIPhoneHealth();
  });

  createWindow();
});

app.on("window-all-closed", () => {
  void stopActiveLocationSession(false);
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void stopActiveLocationSession(false);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
