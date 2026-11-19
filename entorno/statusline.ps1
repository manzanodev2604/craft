#!/usr/bin/env pwsh
# Claude Code statusline — Unicode symbols, no emojis
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$raw = $input | Out-String
$d   = $raw | ConvertFrom-Json

$MODEL     = [string]($d.model.display_name                          ?? "Unknown")
$DIR       = [string]($d.workspace.current_dir                       ?? ".")
$CTX_SIZE  = 300000  # ventana de autocompactado (/context); el JSON trae 1M. Cambiar si cambia ese límite
$CTX_USAGE = $d.context_window.current_usage
$STYLE     = [string]($d.output_style.name                           ?? "")
$FIVE_PCT  = $d.rate_limits.five_hour.used_percentage
$SEVEN_PCT = $d.rate_limits.seven_day.used_percentage
$FIVE_RST  = $d.rate_limits.five_hour.resets_at

# ANSI — use ${E} to prevent $E[N] array-subscript mis-parsing
$E   = [char]27
$R   = "${E}[0m"
$B   = "${E}[1m"
$DM  = "${E}[2m"
$CL  = "${E}[K"
$CW  = "${E}[38;2;210;210;210m"
$CGR = "${E}[38;2;130;130;130m"
$CDK = "${E}[38;2;90;90;90m"
$CBL = "${E}[38;2;100;160;220m"
$CGN = "${E}[38;2;100;195;115m"
$CYL = "${E}[38;2;220;175;75m"
$CRD = "${E}[38;2;210;80;80m"
$CTL = "${E}[38;2;75;195;175m"

function bar([int]$p, [int]$w=10, [string]$c="") {
    $f      = [Math]::Min([Math]::Round($p * $w / 100), $w)
    $filled = [string][char]0x2588 * $f
    $empty  = [string][char]0x2591 * ($w - $f)
    "${c}${filled}${R}${DM}${empty}${R}"
}

function pctColor([int]$p) {
    if ($p -lt 50) { $CTL } elseif ($p -lt 80) { $CYL } else { $CRD }
}

# Git info
$branch = ""; $gstat = ""
try {
    Push-Location $DIR -ErrorAction Stop
    $null = git rev-parse --git-dir 2>$null
    if ($LASTEXITCODE -eq 0) {
        $branch  = (git branch --show-current 2>$null) -join ""
        $staged  = @(git diff --cached --name-only 2>$null).Count
        $unstage = @(git diff --name-only 2>$null).Count
        $untrack = @(git ls-files --others --exclude-standard 2>$null).Count
        if ($staged + $unstage + $untrack -eq 0) {
            $gstat = $CGN + [string][char]0x2713 + $R
        } else {
            $sym = $(if ($staged  -gt 0) {"+"} else {""}) +
                   $(if ($unstage -gt 0) {"!"} else {""}) +
                   $(if ($untrack -gt 0) {"?"} else {""})
            $gstat = "${CYL}${sym}${R}"
        }
    }
    Pop-Location
} catch { try { Pop-Location } catch {} }

# Short dir (last path component)
$home_rx = [regex]::Escape($env:USERPROFILE)
$short   = $DIR -replace $home_rx, "~"
$parts   = $short -split '[/\\]' | Where-Object { $_ -ne '' }
$leaf    = if ($parts.Count -gt 0) { $parts[-1] } else { $short }

# LINE 1: model | style | dir ⎇branch status
$bsym  = [string][char]0x2387   # ⎇
$MODEL_D  = "${CW}${B}${MODEL}${R}"
$STYLE_D  = if ($STYLE) { " ${CGR}${STYLE}${R}" } else { "" }
$DIR_D    = "${CBL}${leaf}${R}"
$BRANCH_D = if ($branch) { " ${CDK}${bsym}${CTL}${branch}${R} ${gstat}" } else { "" }
$LINE1    = "${MODEL_D}${STYLE_D} ${CDK}|${R} ${DIR_D}${BRANCH_D}"

# Context %
$cpct = 0
if ($null -ne $CTX_USAGE) {
    $itok = [long]($CTX_USAGE.input_tokens                    ?? 0)
    $cc   = [long]($CTX_USAGE.cache_creation_input_tokens     ?? 0)
    $cr   = [long]($CTX_USAGE.cache_read_input_tokens         ?? 0)
    if ($CTX_SIZE -gt 0) { $cpct = [Math]::Min([Math]::Round(($itok + $cc + $cr) * 100 / $CTX_SIZE), 100) }
}
$cc2   = pctColor $cpct
$CTX_D = "${CGR}ctx${R} $(bar $cpct 10 $cc2) ${cc2}${B}${cpct}%${R}"

# LINE 2: context | 5H | 7D
if ($null -ne $FIVE_PCT -and "$FIVE_PCT" -ne "") {
    $f5 = [Math]::Round([double]$FIVE_PCT)
    $f7 = if ($null -ne $SEVEN_PCT -and "$SEVEN_PCT" -ne "") { [Math]::Round([double]$SEVEN_PCT) } else { 0 }
    $c5 = pctColor $f5; $c7 = pctColor $f7

    $remain = ""
    if ($FIVE_RST) {
        $dt = [DateTimeOffset]::FromUnixTimeSeconds([long]$FIVE_RST)
        $s  = ($dt - [DateTimeOffset]::UtcNow).TotalSeconds
        if ($s -gt 0) {
            $h = [Math]::Floor($s / 3600); $m = [Math]::Floor(($s % 3600) / 60)
            $remain = " ${CDK}(${h}h${m}m, $($dt.ToLocalTime().ToString('HH:mm')))${R}"
        }
    }
    $LINE2 = "${CTX_D} ${CDK}|${R} ${CGR}5H${R} $(bar $f5 8 $c5) ${c5}${B}${f5}%${R}${remain} ${CDK}|${R} ${CGR}7D${R} $(bar $f7 8 $c7) ${c7}${B}${f7}%${R}"
} else {
    $LINE2 = "${CTX_D} ${CDK}|${R} ${CGR}5H${R} $(bar 0 8 $CTL) ${B}0%${R} ${CDK}|${R} ${CGR}7D${R} $(bar 0 8 $CTL) ${B}0%${R} ${CDK}(loading..)${R}"
}

Write-Output "${LINE1}${CL}"
Write-Output "${LINE2}${CL}"
