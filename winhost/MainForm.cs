using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Greenapple.Native;

public sealed class MainForm : Form
{
    private const int WmNclButtonDown = 0x00A1;
    private const int HtCaption = 0x0002;
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly NativeBridge bridge;
    private bool isFullScreen;
    private FormWindowState previousWindowState;
    private FormBorderStyle previousBorderStyle;

    public MainForm()
    {
        Text = "Greenapple";
        var executableIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (executableIcon is not null) Icon = executableIcon;
        Width = 1280;
        Height = 800;
        MinimumSize = new Size(980, 640);
        BackColor = Color.Black;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(webView);
        bridge = new NativeBridge(this);
        Shown += async (_, _) => await InitializeWebView();
        FormClosing += (_, _) => bridge.Shutdown(clearPersisted: false);
    }

    private async Task InitializeWebView()
    {
        await webView.EnsureCoreWebView2Async();
        webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        webView.CoreWebView2.Settings.IsZoomControlEnabled = true;
        webView.CoreWebView2.WebMessageReceived += async (_, args) => await HandleWebMessage(args.WebMessageAsJson);
        await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);

        var distPath = ExtractBundledUi();
        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "greenapple.local",
            distPath,
            CoreWebView2HostResourceAccessKind.Allow
        );
        webView.CoreWebView2.Navigate("https://greenapple.local/index.html");
    }

    private static string ExtractBundledUi()
    {
        var appDataRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Greenapple",
            "ui"
        );
        var assembly = typeof(MainForm).Assembly;
        var resourceNames = assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith("GreenappleUi/", StringComparison.Ordinal))
            .ToArray();

        if (resourceNames.Length == 0)
        {
            return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "dist"));
        }

        if (Directory.Exists(appDataRoot)) Directory.Delete(appDataRoot, recursive: true);
        Directory.CreateDirectory(appDataRoot);

        foreach (var resourceName in resourceNames)
        {
            var relative = resourceName["GreenappleUi/".Length..]
                .Replace('/', Path.DirectorySeparatorChar)
                .Replace('\\', Path.DirectorySeparatorChar);
            var outputPath = Path.Combine(appDataRoot, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

            using var input = assembly.GetManifestResourceStream(resourceName);
            if (input is null) continue;
            using var output = File.Create(outputPath);
            input.CopyTo(output);
        }

        return appDataRoot;
    }

    private async Task HandleWebMessage(string json)
    {
        var request = JsonSerializer.Deserialize<BridgeRequest>(json, BridgeJsonOptions());
        if (request is null) return;

        object? result;
        try
        {
            result = request.Channel switch
            {
                "window:minimize" => MinimizeWindow(),
                "window:start-drag" => StartWindowDrag(),
                "window:toggle-fullscreen" => ToggleFullscreen(),
                "window:close" => CloseWindow(),
                "bluetooth:request-device" => await bridge.ConnectIPhone(),
                "bluetooth:check-health" => await bridge.CheckHealth(),
                "spoof:ios:set-location" => await bridge.SetLocation(request.Payload ?? throw new InvalidOperationException("Missing location target.")),
                "spoof:ios:reset-location" => await bridge.ResetLocation(),
                "spoof:ios:play-route" => await bridge.PlayRoute(request.Payload ?? throw new InvalidOperationException("Missing route payload.")),
                _ => new NativeResult(false, Error: $"Unknown native channel: {request.Channel}")
            };
        }
        catch (Exception ex)
        {
            result = new NativeResult(false, Error: ex.Message);
        }

        var response = JsonSerializer.Serialize(new BridgeResponse(request.Id, true, result), BridgeJsonOptions());
        webView.CoreWebView2.PostWebMessageAsJson(response);
    }

    private static JsonSerializerOptions BridgeJsonOptions() => new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private object MinimizeWindow()
    {
        WindowState = FormWindowState.Minimized;
        return new { ok = true };
    }

    private object StartWindowDrag()
    {
        if (WindowState == FormWindowState.Maximized) return new { ok = true };
        ReleaseCapture();
        SendMessage(Handle, WmNclButtonDown, HtCaption, 0);
        return new { ok = true };
    }

    private object ToggleFullscreen()
    {
        if (!isFullScreen)
        {
            previousWindowState = WindowState;
            previousBorderStyle = FormBorderStyle;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
            isFullScreen = true;
        }
        else
        {
            FormBorderStyle = previousBorderStyle;
            WindowState = previousWindowState;
            isFullScreen = false;
        }
        return new { ok = true };
    }

    private object CloseWindow()
    {
        Close();
        return new { ok = true };
    }

    private const string BridgeScript = """
(() => {
  const pending = new Map();
  let nextId = 1;
  function invoke(channel, payload) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      chrome.webview.postMessage({ id, channel, payload: payload ?? null });
    });
  }
  chrome.webview.addEventListener('message', (event) => {
    const data = event.data || {};
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.ok) item.resolve(data.result);
    else item.reject(new Error(data.error || 'Native bridge failed'));
  });
  window.ghostWindow = {
    minimize: () => invoke('window:minimize'),
    startDrag: () => invoke('window:start-drag'),
    toggleFullscreen: () => invoke('window:toggle-fullscreen'),
    close: () => invoke('window:close')
  };
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.app-drag')) return;
    if (target.closest('.app-no-drag, button, input, textarea, select, a')) return;
    event.preventDefault();
    void window.ghostWindow.startDrag();
  });
  window.ghostSpoof = {
    setIOSLocation: (target) => invoke('spoof:ios:set-location', target),
    resetIOSLocation: () => invoke('spoof:ios:reset-location'),
    playIOSRoute: (route) => invoke('spoof:ios:play-route', route)
  };
  window.ghostBluetooth = {
    requestDevice: () => invoke('bluetooth:request-device'),
    checkHealth: () => invoke('bluetooth:check-health')
  };
})();
""";

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);
}

public sealed record BridgeRequest(int Id, string Channel, JsonElement? Payload);
public sealed record BridgeResponse(int Id, bool Ok, object? Result = null, string? Error = null);
public sealed record NativeResult(bool Ok, string[]? Command = null, string Stdout = "", string Stderr = "", string? Error = null, string? Name = null, string? Id = null, bool? WirelessReady = null, string? TunnelState = null, int ReconnectCount = 0);

public sealed class NativeBridge
{
    private const int TunnelPort = 49151;
    private readonly Form owner;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private Process? locationProcess;
    private System.Threading.Timer? watchdogTimer;
    private SpoofTarget? activeTarget;
    private string tunnelState = "DISCONNECTED";
    private int reconnectCount;
    private string? lastError;

    public NativeBridge(Form owner)
    {
        this.owner = owner;
    }

    public void Shutdown(bool clearPersisted)
    {
        watchdogTimer?.Dispose();
        watchdogTimer = null;
        StopLocationProcess();
        if (clearPersisted) ClearHeldLocation();
    }

    public async Task<NativeResult> ConnectIPhone()
    {
        if (await CanUseDeveloperTunnel())
        {
            var resumed = await ResumePersistedLocationIfReady();
            return new NativeResult(true, Name: "iPhone", WirelessReady: true, TunnelState: tunnelState, ReconnectCount: reconnectCount, Stdout: resumed ? "Wi-Fi developer tunnel ready. Last location re-pushed." : "Wi-Fi developer tunnel ready.");
        }

        var usb = await RunPython(["-m", "pymobiledevice3", "usbmux", "list"], TimeSpan.FromSeconds(20));
        if (!usb.Ok)
        {
            return new NativeResult(false, Stdout: usb.Stdout, Stderr: usb.Stderr, TunnelState: "DISCONNECTED", Error: FriendlyError(usb));
        }

        await RunPython(["-m", "pymobiledevice3", "lockdown", "wifi-connections", "--state", "on"], TimeSpan.FromSeconds(25));
        await EnsureTunnel();
        var ready = await CanUseDeveloperTunnel();
        return new NativeResult(true, Name: ExtractDeviceName(usb.Stdout), WirelessReady: ready, TunnelState: ready ? tunnelState : "CONNECTED", Stdout: ready ? "Wi-Fi developer tunnel ready." : "USB ready. Keep iPhone unlocked for Wi-Fi tunnel.");
    }

    public async Task<NativeResult> CheckHealth()
    {
        if (await CanUseDeveloperTunnel())
        {
            var resumed = await ResumePersistedLocationIfReady();
            return new NativeResult(true, Name: "iPhone", WirelessReady: true, TunnelState: tunnelState, ReconnectCount: reconnectCount, Stdout: resumed ? "Wi-Fi developer tunnel ready. Last location re-pushed." : "Wi-Fi developer tunnel ready.");
        }

        if (activeTarget is not null)
        {
            tunnelState = "RECONNECTING";
            lastError = "Tunnel dropped. Waiting for iPhone to wake or network to reconnect.";
            ScheduleWatchdog(1000);
            return new NativeResult(false, WirelessReady: false, TunnelState: tunnelState, ReconnectCount: reconnectCount, Error: lastError);
        }

        var usb = await RunPython(["-m", "pymobiledevice3", "usbmux", "list"], TimeSpan.FromSeconds(10));
        return usb.Ok
            ? new NativeResult(true, Name: ExtractDeviceName(usb.Stdout), WirelessReady: false, TunnelState: "CONNECTED", Stdout: usb.Stdout)
            : new NativeResult(false, TunnelState: "DISCONNECTED", Error: FriendlyError(usb), Stdout: usb.Stdout, Stderr: usb.Stderr);
    }

    public async Task<NativeResult> SetLocation(JsonElement payload)
    {
        var target = payload.Deserialize<SpoofTarget>(JsonOptions()) ?? throw new InvalidOperationException("Missing location target.");
        Validate(target);
        activeTarget = target;
        SaveHeldLocation(target);
        tunnelState = "CONNECTING";
        return await StartLocationProcess(target);
    }

    public async Task<NativeResult> ResetLocation()
    {
        Shutdown(clearPersisted: true);
        var endpoint = await GetRsdEndpoint();
        var result = endpoint is null
            ? new NativeResult(false, Error: "Wi-Fi developer tunnel is not ready.")
            : await RunPython(["-m", "pymobiledevice3", "developer", "dvt", "simulate-location", "clear", "--rsd", endpoint.Host, endpoint.Port.ToString()], TimeSpan.FromSeconds(60));
        tunnelState = "DISCONNECTED";
        return result;
    }

    public async Task<NativeResult> PlayRoute(JsonElement payload)
    {
        var route = payload.Deserialize<RoutePayload>(JsonOptions()) ?? throw new InvalidOperationException("Missing route payload.");
        if (route.Points.Count < 2) return new NativeResult(false, Error: "Route needs at least two points.");
        var gpx = Path.Combine(Path.GetTempPath(), $"greenapple-route-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.gpx");
        await File.WriteAllTextAsync(gpx, BuildGpx(route), Encoding.UTF8);
        var endpoint = await GetRsdEndpoint();
        if (endpoint is null) return new NativeResult(false, Error: "Wi-Fi developer tunnel is not ready.");
        var result = await RunPython(["-m", "pymobiledevice3", "developer", "dvt", "simulate-location", "play", "--rsd", endpoint.Host, endpoint.Port.ToString(), gpx], TimeSpan.FromSeconds(90));
        return result;
    }

    private async Task<bool> ResumePersistedLocationIfReady()
    {
        if (activeTarget is not null) return false;
        var target = ReadHeldLocation();
        if (target is null) return false;
        activeTarget = target;
        var result = await StartLocationProcess(target);
        return result.Ok;
    }

    private async Task<NativeResult> StartLocationProcess(SpoofTarget target)
    {
        StopLocationProcess();
        await EnsureTunnel();
        var endpoint = await GetRsdEndpoint();
        if (endpoint is null) return new NativeResult(false, Error: "Wi-Fi developer tunnel is not ready.");
        var args = new[] { "-m", "pymobiledevice3", "developer", "dvt", "simulate-location", "set", "--rsd", endpoint.Host, endpoint.Port.ToString(), "--", target.Lat.ToString("F7"), target.Lng.ToString("F7") };
        var start = new ProcessStartInfo(ResolvePython())
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        locationProcess = Process.Start(start);
        if (locationProcess is null) return new NativeResult(false, Error: "Could not start iPhone location process.");
        var ready = await WaitForProcessReady(locationProcess, args, TimeSpan.FromSeconds(60));
        if (ready.Ok)
        {
            tunnelState = "SPOOFING";
            reconnectCount = 0;
            lastError = null;
            ScheduleWatchdog(2000);
        }
        return ready;
    }

    private async Task<NativeResult> WaitForProcessReady(Process process, string[] args, TimeSpan timeout)
    {
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) stdout.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) stderr.AppendLine(e.Data); };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        var started = DateTime.UtcNow;
        while (!process.HasExited && DateTime.UtcNow - started < timeout)
        {
            if (stdout.ToString().Contains("Press ENTER to exit>", StringComparison.OrdinalIgnoreCase))
            {
                return new NativeResult(true, Command: [ResolvePython(), .. args], Stdout: stdout.ToString(), Stderr: stderr.ToString());
            }
            if (DateTime.UtcNow - started >= TimeSpan.FromSeconds(3))
            {
                return new NativeResult(true, Command: [ResolvePython(), .. args], Stdout: stdout.ToString(), Stderr: stderr.ToString());
            }
            await Task.Delay(250);
        }
        if (!process.HasExited && DateTime.UtcNow - started >= timeout) process.Kill();
        return new NativeResult(false, Stdout: stdout.ToString(), Stderr: stderr.ToString(), Error: stderr.Length > 0 ? stderr.ToString() : "Timed out while starting iPhone location session.");
    }

    private void ScheduleWatchdog(int delayMs)
    {
        watchdogTimer?.Dispose();
        watchdogTimer = new System.Threading.Timer(async _ => await WatchdogTick(), null, delayMs, Timeout.Infinite);
    }

    private async Task WatchdogTick()
    {
        if (activeTarget is null) return;
        var ready = await CanUseDeveloperTunnel();
        if (!ready)
        {
            reconnectCount++;
            tunnelState = "RECONNECTING";
            lastError = "Tunnel dropped. Waiting for iPhone to wake or network to reconnect.";
            StopLocationProcess();
            await EnsureTunnel();
            ScheduleWatchdog(2000);
            return;
        }

        if (locationProcess is null || locationProcess.HasExited || tunnelState is "RECONNECTING" or "CONNECTING")
        {
            await StartLocationProcess(activeTarget);
            return;
        }

        tunnelState = "SPOOFING";
        ScheduleWatchdog(2000);
    }

    private async Task EnsureTunnel()
    {
        if (await CanUseDeveloperTunnel()) return;
        StartTunneldElevated();
        for (var i = 0; i < 20; i++)
        {
            await Task.Delay(1000);
            if (await CanUseDeveloperTunnel()) return;
        }
    }

    private void StartTunneldElevated()
    {
        var python = ResolvePython();
        var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Greenapple", "tunneld.log");
        Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
        var command = $"& '{python.Replace("'", "''")}' -m pymobiledevice3 remote tunneld --protocol tcp --host 127.0.0.1 --port {TunnelPort} *> '{logPath.Replace("'", "''")}'";
        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -Command \"Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','{command.Replace("'", "''")}' -Verb RunAs -WindowStyle Hidden\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }

    private async Task<bool> CanUseDeveloperTunnel()
    {
        var endpoint = await GetRsdEndpoint();
        if (endpoint is null) return false;
        var result = await RunPython(["-m", "pymobiledevice3", "developer", "dvt", "ls", "/", "--rsd", endpoint.Host, endpoint.Port.ToString()], TimeSpan.FromSeconds(8));
        return result.Ok;
    }

    private async Task<RsdEndpoint?> GetRsdEndpoint()
    {
        try
        {
            using var response = await http.GetAsync($"http://127.0.0.1:{TunnelPort}/");
            if (!response.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            foreach (var device in doc.RootElement.EnumerateObject())
            {
                foreach (var endpoint in device.Value.EnumerateArray())
                {
                    if (endpoint.TryGetProperty("tunnel-address", out var host) &&
                        endpoint.TryGetProperty("tunnel-port", out var port))
                    {
                        return new RsdEndpoint(host.GetString() ?? "", port.GetInt32());
                    }
                }
            }
        }
        catch
        {
            return null;
        }
        return null;
    }

    private async Task<NativeResult> RunPython(string[] args, TimeSpan timeout)
    {
        return await Task.Run(() =>
        {
            var psi = new ProcessStartInfo(ResolvePython())
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = AppContext.BaseDirectory
            };
            foreach (var arg in args) psi.ArgumentList.Add(arg);
            using var process = Process.Start(psi);
            if (process is null) return new NativeResult(false, Error: "Could not start Python.");

            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            process.OutputDataReceived += (_, e) => { if (e.Data is not null) stdout.AppendLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data is not null) stderr.AppendLine(e.Data); };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            if (!process.WaitForExit((int)timeout.TotalMilliseconds))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return new NativeResult(false, Command: [ResolvePython(), .. args], Stdout: stdout.ToString(), Stderr: stderr.ToString(), Error: "Python command timed out.");
            }
            process.WaitForExit();
            var outText = stdout.ToString();
            var errText = stderr.ToString();
            var ok = process.ExitCode == 0 && !HasCommandError(outText, errText);
            return new NativeResult(ok, Command: [ResolvePython(), .. args], Stdout: outText, Stderr: errText, Error: ok ? null : FriendlyError(new NativeResult(false, Stdout: outText, Stderr: errText)));
        });
    }

    private static string ResolvePython()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var py313 = Path.Combine(local, "Programs", "Python", "Python313", "python.exe");
        if (File.Exists(py313)) return py313;
        return "python";
    }

    private void StopLocationProcess()
    {
        if (locationProcess is null) return;
        try
        {
            if (!locationProcess.HasExited)
            {
                locationProcess.StandardInput.WriteLine();
                locationProcess.StandardInput.Flush();
                if (!locationProcess.WaitForExit(1200)) locationProcess.Kill();
            }
        }
        catch { }
        finally
        {
            locationProcess.Dispose();
            locationProcess = null;
        }
    }

    private string HeldLocationFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Greenapple", "held-location.json");
    private void SaveHeldLocation(SpoofTarget target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(HeldLocationFile)!);
        File.WriteAllText(HeldLocationFile, JsonSerializer.Serialize(target, JsonOptions()));
    }
    private SpoofTarget? ReadHeldLocation()
    {
        try
        {
            if (!File.Exists(HeldLocationFile)) return null;
            return JsonSerializer.Deserialize<SpoofTarget>(File.ReadAllText(HeldLocationFile), JsonOptions());
        }
        catch { return null; }
    }
    private void ClearHeldLocation()
    {
        if (File.Exists(HeldLocationFile)) File.Delete(HeldLocationFile);
    }

    private static bool HasCommandError(string stdout, string stderr) => $"{stdout} {stderr}".Contains("ERROR", StringComparison.OrdinalIgnoreCase) || $"{stdout} {stderr}".Contains("No device", StringComparison.OrdinalIgnoreCase) || $"{stdout} {stderr}".Contains("not connected", StringComparison.OrdinalIgnoreCase);
    private static string FriendlyError(NativeResult result)
    {
        var text = $"{result.Stdout} {result.Stderr} {result.Error}";
        if (text.Contains("No module named pymobiledevice3", StringComparison.OrdinalIgnoreCase)) return "pymobiledevice3 is missing from Python 3.13.";
        if (text.Contains("No device", StringComparison.OrdinalIgnoreCase)) return "No trusted iPhone detected. Unlock, trust this PC, and enable Developer Mode.";
        return string.IsNullOrWhiteSpace(text) ? "iPhone command failed." : text.Trim();
    }
    private static void Validate(SpoofTarget target)
    {
        if (target.Lat is < -90 or > 90) throw new InvalidOperationException("Latitude must be between -90 and 90.");
        if (target.Lng is < -180 or > 180) throw new InvalidOperationException("Longitude must be between -180 and 180.");
    }
    private static JsonSerializerOptions JsonOptions() => new() { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static string ExtractDeviceName(string stdout)
    {
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var first = doc.RootElement.EnumerateArray().FirstOrDefault();
            if (first.ValueKind == JsonValueKind.Object && first.TryGetProperty("DeviceName", out var name)) return name.GetString() ?? "iPhone";
        }
        catch { }
        return "iPhone";
    }
    private static string BuildGpx(RoutePayload route)
    {
        var now = DateTimeOffset.UtcNow;
        var seconds = Math.Max(3, (int)Math.Round(3600.0 / Math.Max(1, route.SpeedKmh)));
        var points = route.Points.Select((p, i) => $"    <trkpt lat=\"{p.Lat:F7}\" lon=\"{p.Lng:F7}\"><time>{now.AddSeconds(i * seconds):O}</time></trkpt>");
        return $"""
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Greenapple" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Greenapple Route</name>
    <trkseg>
{string.Join("\n", points)}
    </trkseg>
  </trk>
</gpx>
""";
    }
}

public sealed record SpoofTarget(double Lng, double Lat, string? Name);
public sealed record RoutePayload(List<SpoofTarget> Points, double SpeedKmh);
public sealed record RsdEndpoint(string Host, int Port);
