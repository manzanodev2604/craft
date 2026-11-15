# Closes the browser's "automated test software is controlling ..." infobar that appears while cdp.mjs is connected.
# Clicks its close button with POSTED mouse messages (not UIA Invoke, which activates the window), so the user's
# focus is never touched. Closing it in one window closes it in all. Launched by cdp.mjs while connecting; cap 30 s (covers the allow prompt).
param([string]$Browser = 'brave')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type 'using System;using System.Runtime.InteropServices;public class PM{[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);[DllImport("user32.dll")]public static extern bool ScreenToClient(IntPtr h,ref POINT p);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);public struct POINT{public int X,Y;}}'
$A = [System.Windows.Automation.AutomationElement]; $All = [System.Windows.Automation.Condition]::TrueCondition
$cls = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Chrome_WidgetWin_1')
$ibCls = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'ConfirmInfoBarWithNormalLabel')
$log = { param($m) "[$(Get-Date -Format HH:mm:ss.fff)] dismiss ${Browser}: $m" }
$find = { foreach ($w in $A::RootElement.FindAll('Children', $cls)) {
  try { if ((Get-Process -Id $w.Current.ProcessId).Name -ne $Browser) { continue } } catch { continue }
  if ([PM]::IsIconic([IntPtr]$w.Current.NativeWindowHandle)) { continue } # minimized: no layout to click on
  foreach ($ib in $w.FindAll('Descendants', $ibCls)) { # class filter runs inside UIA: much faster than listing all
    $kids = $ib.FindAll('Descendants', $All)
    if ($kids | Where-Object { $_.Current.Name -match 'automatizado|automated test' }) {
      $x = $kids | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $_.Current.Name -in 'Cerrar', 'Close' } | Select-Object -First 1
      if ($x) { , @($w, $x) }
    } } } }
$end = (Get-Date).AddSeconds(30); $clicked = 0
while ((Get-Date) -lt $end) {
  $hit = & $find | Select-Object -First 1
  if (-not $hit) { if ($clicked) { & $log 'closed'; exit 0 }; Start-Sleep -Milliseconds 100; continue }
  $w, $x = $hit; $r = $x.Current.BoundingRectangle; $h = [IntPtr]$w.Current.NativeWindowHandle
  $p = New-Object PM+POINT; $p.X = [int]($r.X + $r.Width / 2); $p.Y = [int]($r.Y + $r.Height / 2)
  [PM]::ScreenToClient($h, [ref]$p) | Out-Null; $lp = [IntPtr](($p.Y -shl 16) -bor ($p.X -band 0xFFFF))
  [PM]::PostMessage($h, 0x0200, [IntPtr]0, $lp) | Out-Null; Start-Sleep -Milliseconds 50  # WM_MOUSEMOVE (hover)
  [PM]::PostMessage($h, 0x0201, [IntPtr]1, $lp) | Out-Null; Start-Sleep -Milliseconds 50  # WM_LBUTTONDOWN
  [PM]::PostMessage($h, 0x0202, [IntPtr]0, $lp) | Out-Null                                # WM_LBUTTONUP
  $clicked++; Start-Sleep -Milliseconds 400
}
& $log "gave up (clicks: $clicked)"; exit 1
