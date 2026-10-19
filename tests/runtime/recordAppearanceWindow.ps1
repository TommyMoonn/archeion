param(
  [Parameter(Mandatory)][string]$BinaryPath,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [switch]$Reload,
  [switch]$FocusOwnedWindow,
  [int]$DurationMs = 4000,
  [int]$IntervalMs = 33
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($DurationMs -lt 1000 -or $DurationMs -gt 10000 -or $IntervalMs -lt 16) { throw 'Unsupported capture interval' }
$resolvedBinary = (Resolve-Path -LiteralPath $BinaryPath).Path
$processes = @(Get-Process | Where-Object { $_.Path -eq $resolvedBinary -and $_.MainWindowHandle -ne 0 })
if ($processes.Count -ne 1) { throw 'The recorder requires exactly one owned test application window' }
$handle = $processes[0].MainWindowHandle
New-Item -ItemType Directory -Path $OutputDirectory -ErrorAction Stop | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AppearanceCaptureWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Key,Scan; public uint Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Payload { [FieldOffset(0)] public Keyboard Keyboard; [FieldOffset(0)] public Mouse Mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Payload Payload; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
  public static void Reload() {
    var inputs=new Input[4]; var keys=new ushort[]{0x11,0x52,0x52,0x11};
    for(int i=0;i<4;i++){ inputs[i].Type=1; inputs[i].Payload.Keyboard.Key=keys[i]; inputs[i].Payload.Keyboard.Flags=i>=2?2u:0u; }
    if(SendInput(4,inputs,Marshal.SizeOf<Input>())!=4) throw new InvalidOperationException("Ctrl+R input was not delivered");
  }
}
'@
# Physical client coordinates, including the pre-document interval. No DOM/WebDriver screenshots.
[void][AppearanceCaptureWindow]::SetProcessDpiAwarenessContext([IntPtr](-4))
if ($FocusOwnedWindow) {
  # Test preparation only. Do not synthesize input to acquire another window's focus.
  $activation = New-Object -ComObject WScript.Shell
  try {
    if (-not $activation.AppActivate($processes[0].Id)) { throw 'The owned test window could not be activated' }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($activation) }
}
$clock = [Diagnostics.Stopwatch]::StartNew()
$samples = [Collections.Generic.List[object]]::new()
$origin = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$readySent = $false
$reloadAt = $null
while ($clock.ElapsedMilliseconds -lt $DurationMs) {
  if (-not [AppearanceCaptureWindow]::IsWindow($handle)) { throw 'The owned window was destroyed during capture' }
  $at = $clock.Elapsed.TotalMilliseconds
  if ([AppearanceCaptureWindow]::GetForegroundWindow() -ne $handle) {
    $samples.Add(@{ timeMs = $at; gap = 'owned window not foreground; pixels not captured' })
  } else {
    $rect = [AppearanceCaptureWindow+Rect]::new()
    $point = [AppearanceCaptureWindow+Point]::new()
    if (-not [AppearanceCaptureWindow]::GetClientRect($handle, [ref]$rect) -or -not [AppearanceCaptureWindow]::ClientToScreen($handle, [ref]$point)) { throw 'Client geometry unavailable' }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 100 -or $height -lt 100) { throw 'Owned client area too small for paint samples' }
    $bitmap = [Drawing.Bitmap]::new($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($point.X, $point.Y, 0, 0, $bitmap.Size)
      $pixel = $bitmap.GetPixel($width - 12, $height - 12)
      $file = 'frame-{0:D4}.png' -f $samples.Count
      $bitmap.Save((Join-Path $OutputDirectory $file), [Drawing.Imaging.ImageFormat]::Png)
      $samples.Add(@{ timeMs = $at; file = $file; width = $width; height = $height; background = ('#{0:x2}{1:x2}{2:x2}' -f $pixel.R,$pixel.G,$pixel.B) })
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    if (-not $readySent) { [Console]::WriteLine('CAPTURE_READY'); [Console]::Out.Flush(); $readySent = $true }
    if ($Reload -and $null -eq $reloadAt -and $samples.Count -ge 3) {
      if ([AppearanceCaptureWindow]::GetForegroundWindow() -ne $handle) { throw 'Refusing keyboard input outside the owned window' }
      $reloadAt = $clock.Elapsed.TotalMilliseconds
      [AppearanceCaptureWindow]::Reload()
    }
  }
  $remaining = $IntervalMs - ($clock.Elapsed.TotalMilliseconds - $at)
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]$remaining) }
}
if (-not $readySent) { throw 'No foreground owned-window frame could be captured' }
$report = @{ originEpochMs = $origin; reloadAtMs = $reloadAt; requestedIntervalMs = $IntervalMs; elapsedMs = $clock.Elapsed.TotalMilliseconds; focusRequestedBeforeCapture = [bool]$FocusOwnedWindow; method = 'Windows client rectangle CopyFromScreen; foreground-guarded OS SendInput Ctrl+R'; samples = $samples }
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'capture.json'), ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
