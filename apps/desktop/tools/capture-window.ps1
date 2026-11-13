param(
    [string]$ProcessName = "craftsharp-desktop",
    [string]$OutputPath = "window.png",
    [string]$Title = "",
    [string]$Method = "screen"
)

Add-Type -AssemblyName System.Drawing

# 先声明每显示器 DPI 感知，否则窗口坐标是虚拟化后的，截图会被裁切
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DpiAwareness
{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
"@
[DpiAwareness]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

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
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);

    public static IntPtr FindByTitle(uint pid, string title)
    {
        IntPtr found = IntPtr.Zero;

        EnumWindows((hWnd, lParam) =>
        {
            uint owner;
            GetWindowThreadProcessId(hWnd, out owner);
            if (owner != pid || !IsWindowVisible(hWnd)) return true;

            var text = new System.Text.StringBuilder(260);
            GetWindowText(hWnd, text, 260);
            if (text.ToString() == title)
            {
                found = hWnd;
                return false;
            }

            return true;
        }, IntPtr.Zero);

        return found;
    }

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
$handle = if ($Title) {
    [Win32Capture]::FindByTitle([uint32]$process.Id, $Title)
} else {
    $process.MainWindowHandle
}

if ($handle -eq [IntPtr]::Zero) {
    throw "No window found for $ProcessName (title: '$Title')"
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
    if ($Method -eq "print") {
        $hdc = $graphics.GetHdc()
        try {
            # PW_RENDERFULLCONTENT，能抓到被遮挡的 WebView2 内容
            [Win32Capture]::PrintWindow($handle, $hdc, 2) | Out-Null
        }
        finally {
            $graphics.ReleaseHdc($hdc)
        }
    }
    else {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    }

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    [Win32Capture]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0003) | Out-Null
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Output "$($rect.Left),$($rect.Top) ${width}x${height}"
