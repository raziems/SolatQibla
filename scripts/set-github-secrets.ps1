# Creates the FTP_USERNAME and FTP_PASSWORD Actions secrets on the GitHub repo so the deploy workflow can run.
# Uses the GitHub token already stored in Git Credential Manager (the one `git push` uses) and PHP's sodium
# extension to seal the secret, exactly like TeamBoard's script.
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\set-github-secrets.ps1 -FtpUsername if0_12345678
param(
    [string]$Repo = "raziems/SolatQibla",
    [Parameter(Mandatory = $true)][string]$FtpUsername
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$secure = Read-Host "InfinityFree hosting account password for $FtpUsername" -AsSecureString
$ftpPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $ftpPassword) { throw "No password entered" }

# GitHub token from Git Credential Manager
$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred | Where-Object { $_ -like "password=*" }) -replace "^password=", ""
if (-not $token) { throw "No GitHub credential found in Git Credential Manager" }

$php = (Get-Command php -ErrorAction SilentlyContinue).Source
if (-not $php) { $php = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe" }
if (-not (Test-Path $php)) { throw "php.exe not found (winget install PHP.PHP.8.3)" }
$seal = Join-Path $env:TEMP "gh-seal.php"
'<?php echo base64_encode(sodium_crypto_box_seal($argv[2], base64_decode($argv[1])));' | Set-Content $seal -Encoding ASCII

$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "SolatQibla-setup" }
$pk = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repo/actions/secrets/public-key"

function Set-RepoSecret([string]$name, [string]$value) {
    $enc = & $php -d "extension_dir=$(Split-Path $php)\ext" -d "extension=sodium" $seal $pk.key $value
    $body = @{ encrypted_value = $enc; key_id = $pk.key_id } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Put -Headers $headers -ContentType "application/json" `
        -Uri "https://api.github.com/repos/$Repo/actions/secrets/$name" -Body $body | Out-Null
    Write-Host "Saved secret $name"
}

Set-RepoSecret "FTP_USERNAME" $FtpUsername
Set-RepoSecret "FTP_PASSWORD" $ftpPassword
Remove-Item $seal -ErrorAction SilentlyContinue

Write-Host "Done. Push to main (or run the workflow from the Actions tab) to deploy."
