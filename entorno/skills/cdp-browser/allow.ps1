# Auto-clicks "Permitir"/"Allow" on Brave/Chrome's "Allow remote debugging?" prompt.
# Launched by cdp.mjs ONLY while its own daemon is connecting, killed as soon as it connects; hard cap 30 s.
# ponytail: matches the dialog by title text (es/en); another UI language needs its title added here.
# Chromium drops clicks that land < ~0.5 s after the dialog shows or after a previous click
# (anti-clickjacking), so: wait 0.9 s after first sight, then click at most every 1.2 s.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]; $T = [System.Windows.Automation.TreeScope]
$isWin = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$isBtn = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$browserCls = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Chrome_WidgetWin_1')
$log = { param($m) "[$(Get-Date -Format HH:mm:ss.fff)] $m" }
& $log 'helper start'
$end = (Get-Date).AddSeconds(30); $firstSeen = $null; $lastClick = [datetime]::MinValue
while ((Get-Date) -lt $end) {
  $found = $false
  foreach ($w in $A::RootElement.FindAll($T::Children, $browserCls)) {
    try { $proc = (Get-Process -Id $w.Current.ProcessId).Name } catch { continue }
    if ($proc -notin 'brave', 'chrome') { continue }
    foreach ($d in $w.FindAll($T::Descendants, $isWin)) {
      if ($d.Current.Name -notmatch '(depuraci.n remota|remote debugging)\?$') { continue }
      $b = $d.FindAll($T::Descendants, $isBtn) | Where-Object { $_.Current.Name -in 'Permitir', 'Allow' } | Select-Object -First 1
      if (-not $b) { continue }
      $found = $true; $now = Get-Date
      if (-not $firstSeen) { $firstSeen = $now; & $log "prompt seen ($proc)" }
      if (($now - $firstSeen).TotalMilliseconds -ge 900 -and ($now - $lastClick).TotalMilliseconds -ge 1200) {
        try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $lastClick = $now; & $log "clicked allow ($proc)" } catch {}
      }
      break  # one prompt per pass; a queued stale one gets handled on the next passes
    }
  }
  if (-not $found) { $firstSeen = $null }  # next prompt in queue gets its own 0.9 s
  Start-Sleep -Milliseconds 250
}
exit 1
