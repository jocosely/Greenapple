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
    private Process? tunnelProcess;
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
        StopRouteRunner();
        StopLocationProcess();
        StopTunnelProcess();
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
        return await StartLocationProcess(target, stopExistingFirst: false);
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
        foreach (var point in route.Points) Validate(point);
        ClearHeldLocation();
        await EnsureTunnel();
        var first = route.Points[0];
        activeTarget = first;
        var prime = await StartLocationProcess(first, stopExistingFirst: false, ensureTunnelFirst: false);
        if (!prime.Ok) return prime;
        var result = await StartRouteWorker(route);
        if (!result.Ok) return result;
        activeTarget = route.Points[^1];
        SaveHeldLocation(route.Points[^1]);
        tunnelState = "SPOOFING";
        reconnectCount = 0;
        lastError = null;
        ScheduleWatchdog(2000);
        return result with { Stdout = string.IsNullOrWhiteSpace(result.Stdout) ? "Route GPS session started." : result.Stdout };
    }

    private async Task<NativeResult> StartRouteWorker(RoutePayload route)
    {
        var oldProcess = locationProcess;
        var endpoint = await GetRsdEndpoint();
        if (endpoint is null) return new NativeResult(false, Error: "Wi-Fi developer tunnel is not ready.");
        var workerPath = EnsureRouteWorkerScript();
        var routePath = Path.Combine(Path.GetTempPath(), $"greenapple-route-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.json");
        await File.WriteAllTextAsync(routePath, JsonSerializer.Serialize(route, JsonOptions()), Encoding.UTF8);
        var args = new[] { workerPath, endpoint.Host, endpoint.Port.ToString(), routePath };
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
        var nextProcess = Process.Start(start);
        if (nextProcess is null) return new NativeResult(false, Error: "Could not start iPhone route worker.");
        var ready = await WaitForProcessReady(nextProcess, args, TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(4), "GREENAPPLE_ROUTE_READY");
        if (ready.Ok)
        {
            locationProcess = nextProcess;
            if (oldProcess is not null && !ReferenceEquals(oldProcess, nextProcess))
            {
                StopProcess(oldProcess);
            }
            tunnelState = "SPOOFING";
            reconnectCount = 0;
            lastError = null;
            ScheduleWatchdog(2000);
        }
        else
        {
            StopProcess(nextProcess);
            if (locationProcess is null && oldProcess is not null && !oldProcess.HasExited) locationProcess = oldProcess;
        }
        return ready;
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

    private async Task<NativeResult> StartLocationProcess(SpoofTarget target, bool stopExistingFirst = true, TimeSpan? readyAfter = null, bool ensureTunnelFirst = true)
    {
        var oldProcess = locationProcess;
        if (stopExistingFirst)
        {
            StopLocationProcess();
            oldProcess = null;
        }
        if (ensureTunnelFirst) await EnsureTunnel();
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
        var nextProcess = Process.Start(start);
        if (nextProcess is null) return new NativeResult(false, Error: "Could not start iPhone location process.");
        var ready = await WaitForProcessReady(nextProcess, args, TimeSpan.FromSeconds(60), readyAfter ?? TimeSpan.FromSeconds(3));
        if (ready.Ok)
        {
            locationProcess = nextProcess;
            if (oldProcess is not null && !ReferenceEquals(oldProcess, nextProcess))
            {
                StopProcess(oldProcess);
            }
            tunnelState = "SPOOFING";
            reconnectCount = 0;
            lastError = null;
            ScheduleWatchdog(2000);
        }
        else
        {
            StopProcess(nextProcess);
            if (locationProcess is null && oldProcess is not null && !oldProcess.HasExited) locationProcess = oldProcess;
        }
        return ready;
    }

    private async Task<NativeResult> WaitForProcessReady(Process process, string[] args, TimeSpan timeout, TimeSpan readyAfter, string? readyText = null)
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
            if (readyText is not null && stdout.ToString().Contains(readyText, StringComparison.OrdinalIgnoreCase))
            {
                return new NativeResult(true, Command: [ResolvePython(), .. args], Stdout: stdout.ToString(), Stderr: stderr.ToString());
            }
            if (stdout.ToString().Contains("Press ENTER to exit>", StringComparison.OrdinalIgnoreCase))
            {
                return new NativeResult(true, Command: [ResolvePython(), .. args], Stdout: stdout.ToString(), Stderr: stderr.ToString());
            }
            if (readyText is null && DateTime.UtcNow - started >= readyAfter)
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

        if (activeTarget is not null && (locationProcess is null || locationProcess.HasExited || tunnelState is "RECONNECTING" or "CONNECTING"))
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
        StartTunneld();
        for (var i = 0; i < 20; i++)
        {
            await Task.Delay(1000);
            if (await CanUseDeveloperTunnel()) return;
        }
    }

    private void StartTunneld()
    {
        if (tunnelProcess is not null && !tunnelProcess.HasExited) return;
        var python = ResolvePython();
        var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Greenapple", "tunneld.log");
        Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
        var start = new ProcessStartInfo(python)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        foreach (var arg in new[] { "-m", "pymobiledevice3", "remote", "tunneld", "--protocol", "tcp", "--host", "127.0.0.1", "--port", TunnelPort.ToString() })
        {
            start.ArgumentList.Add(arg);
        }
        tunnelProcess = Process.Start(start);
        if (tunnelProcess is null) return;
        tunnelProcess.OutputDataReceived += (_, e) => AppendTunnelLog(logPath, e.Data);
        tunnelProcess.ErrorDataReceived += (_, e) => AppendTunnelLog(logPath, e.Data);
        tunnelProcess.BeginOutputReadLine();
        tunnelProcess.BeginErrorReadLine();
    }

    private static void AppendTunnelLog(string logPath, string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try
        {
            File.AppendAllText(logPath, $"[{DateTimeOffset.Now:O}] {line}{Environment.NewLine}");
        }
        catch { }
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
        StopProcess(locationProcess);
        locationProcess = null;
    }

    private void StopRouteRunner()
    {
        StopLocationProcess();
    }

    private void StopTunnelProcess()
    {
        if (tunnelProcess is null) return;
        StopProcess(tunnelProcess);
        tunnelProcess = null;
    }

    private static void StopProcess(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                try
                {
                    process.StandardInput.WriteLine();
                    process.StandardInput.Flush();
                }
                catch { }
                if (!process.WaitForExit(1200)) process.Kill(entireProcessTree: true);
            }
        }
        catch { }
        finally
        {
            process.Dispose();
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
    private static double DistanceMeters(SpoofTarget a, SpoofTarget b)
    {
        const double radius = 6371000;
        static double ToRad(double value) => value * Math.PI / 180.0;
        var dLat = ToRad(b.Lat - a.Lat);
        var dLng = ToRad(b.Lng - a.Lng);
        var lat1 = ToRad(a.Lat);
        var lat2 = ToRad(b.Lat);
        var h = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return 2 * radius * Math.Asin(Math.Sqrt(h));
    }

    private static double RouteDistanceMeters(IReadOnlyList<SpoofTarget> points)
    {
        var total = 0.0;
        for (var i = 1; i < points.Count; i++)
        {
            total += DistanceMeters(points[i - 1], points[i]);
        }
        return total;
    }

    private static SpoofTarget PointAtDistance(IReadOnlyList<SpoofTarget> points, double targetMeters)
    {
        if (points.Count == 0) return new SpoofTarget(-112.074, 33.4484, "Route");
        if (points.Count == 1 || targetMeters <= 0) return points[0];

        var traveled = 0.0;
        for (var i = 1; i < points.Count; i++)
        {
            var start = points[i - 1];
            var end = points[i];
            var segmentMeters = DistanceMeters(start, end);
            if (traveled + segmentMeters >= targetMeters)
            {
                var progress = segmentMeters <= 0 ? 1 : (targetMeters - traveled) / segmentMeters;
                return new SpoofTarget(
                    start.Lng + (end.Lng - start.Lng) * progress,
                    start.Lat + (end.Lat - start.Lat) * progress,
                    targetMeters >= RouteDistanceMeters(points) ? end.Name : start.Name
                );
            }
            traveled += segmentMeters;
        }

        return points[^1];
    }

    private static string EnsureRouteWorkerScript()
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Greenapple");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "greenapple_route_worker.py");
        File.WriteAllText(path, RouteWorkerScript, Encoding.UTF8);
        return path;
    }

    private const string RouteWorkerScript = """
import asyncio
import json
import math
import sys

from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation


def distance_meters(a, b):
    radius = 6371000
    dlat = math.radians(b["lat"] - a["lat"])
    dlng = math.radians(b["lng"] - a["lng"])
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def route_distance(points):
    return sum(distance_meters(points[i - 1], points[i]) for i in range(1, len(points)))


def point_at_distance(points, target):
    if len(points) == 1 or target <= 0:
        return points[0]
    traveled = 0
    for i in range(1, len(points)):
        start = points[i - 1]
        end = points[i]
        segment = distance_meters(start, end)
        if traveled + segment >= target:
            progress = 1 if segment <= 0 else (target - traveled) / segment
            return {
                "lat": start["lat"] + (end["lat"] - start["lat"]) * progress,
                "lng": start["lng"] + (end["lng"] - start["lng"]) * progress,
                "name": end.get("name") if target >= route_distance(points) else start.get("name"),
            }
        traveled += segment
    return points[-1]


async def main():
    if len(sys.argv) != 4:
        print("Usage: greenapple_route_worker.py HOST PORT ROUTE_JSON", file=sys.stderr, flush=True)
        return 2
    host = sys.argv[1]
    port = int(sys.argv[2])
    route_path = sys.argv[3]
    with open(route_path, "r", encoding="utf-8") as f:
        route = json.load(f)
    points = route["points"]
    speed_kmh = max(1, float(route.get("speedKmh", 1)))
    total = max(1, route_distance(points))
    meters_per_second = speed_kmh / 3.6

    rsd = RemoteServiceDiscoveryService((host, port))
    await rsd.connect()
    async with DvtProvider(rsd) as dvt, LocationSimulation(dvt) as location:
        started = asyncio.get_running_loop().time()
        ready = False
        while True:
            elapsed = asyncio.get_running_loop().time() - started
            target = min(total, elapsed * meters_per_second)
            point = point_at_distance(points, target)
            await location.set(point["lat"], point["lng"])
            if not ready:
                print("GREENAPPLE_ROUTE_READY", flush=True)
                ready = True
            if target >= total:
                print("GREENAPPLE_ROUTE_DONE", flush=True)
                break
            await asyncio.sleep(1.0)

        # Keep this DVT session open so iOS continues holding the final simulated location.
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, sys.stdin.readline)
    await rsd.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
""";
}

public sealed record SpoofTarget(double Lng, double Lat, string? Name);
public sealed record RoutePayload(List<SpoofTarget> Points, double SpeedKmh);
public sealed record RsdEndpoint(string Host, int Port);
