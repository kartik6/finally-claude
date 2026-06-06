$ContainerName = "finally-app"

$existing = docker ps -aq -f "name=^$ContainerName$"
if ($existing) {
    Write-Host "Stopping FinAlly..."
    docker rm -f $ContainerName | Out-Null
    Write-Host "Stopped. (Data volume 'finally-data' is preserved.)"
} else {
    Write-Host "FinAlly is not running."
}
