param(
    [switch]$Build,
    [switch]$Open
)

$ErrorActionPreference = "Stop"

# Resolve project root (parent of this script's directory).
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

$ContainerName = "finally-app"
$ImageName = "finally"
$Port = 8000

docker image inspect $ImageName 2>$null | Out-Null
if ($Build -or ($LASTEXITCODE -ne 0)) {
    Write-Host "Building Docker image..."
    docker build -t $ImageName .
}

$existing = docker ps -aq -f "name=^$ContainerName$"
if ($existing) {
    Write-Host "Removing existing container..."
    docker rm -f $ContainerName | Out-Null
}

if (!(Test-Path ".env")) {
    Write-Host "Warning: .env not found. Copying from .env.example..."
    Copy-Item ".env.example" ".env"
    Write-Host "Please edit .env with your API keys."
}

Write-Host "Starting FinAlly..."
docker run -d --name $ContainerName -p "${Port}:8000" -v finally-data:/app/db --env-file .env $ImageName

Write-Host "`nFinAlly is running at: http://localhost:$Port`n"

if ($Open) {
    Start-Sleep 2
    Start-Process "http://localhost:$Port"
}
