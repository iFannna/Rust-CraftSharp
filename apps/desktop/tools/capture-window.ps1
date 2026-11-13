param(
    [string]$ProcessName = "craftsharp-desktop",
    [string]$OutputPath = "window.png"
)

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32Capture
{
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

$process = Get-Process $ProcessName -ErrorAction Stop | Select-Object -First 1
$handle = $process.MainWindowHandle

if ($handle -eq [IntPtr]::Zero) {
    throw "No main window found for $ProcessName"
}

[Win32Capture]::ShowWindow($handle, 9) | Out-Null
[Win32Capture]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x0003) | Out-Null
[Win32Capture]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object Win32Capture+RECT
[Win32Capture]::GetWindowRect($handle, [ref]$rect) | Out-Null

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
    throw "Invalid window size ${width}x${height}"
}

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    [Win32Capture]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0003) | Out-Null
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Output "$($rect.Left),$($rect.Top) ${width}x${height}"
