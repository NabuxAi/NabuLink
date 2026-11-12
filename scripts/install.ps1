# NabuLink Windows installer. Inspect before executing; does not start or pair an agent silently.
$ErrorActionPreference = 'Stop'
foreach ($tool in @('git', 'node', 'npm')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required. Install Git and Node.js 22+ first."
    }
}
$version = [int]((node -v).TrimStart('v').Split('.')[0])
if ($version -lt 22) { throw 'Node.js 22 or newer is required.' }
$target = Join-Path $env:LOCALAPPDATA 'NabuLink'
if (Test-Path (Join-Path $target '.git')) {
    & git -C $target pull --ff-only
} elseif (-not (Test-Path $target)) {
    & git clone https://github.com/NabuxAi/NabuLink.git $target
} else {
    throw "Folder already exists and is not a Git repository: $target"
}
if ($LASTEXITCODE -ne 0) { throw 'Git clone/update failed' }
Push-Location $target
try { & npm ci --omit=dev; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } }
finally { Pop-Location }
Write-Host "Installed to $target"
Write-Host 'Agent does not start automatically. To pair with YOUR server, run:'
Write-Host "node `"$target\apps\agent\agent.mjs`" --server https://YOUR-SERVER --name MyWindows"
Write-Host 'Explicitly add --allow-speech only when you want this device to speak remotely.'
