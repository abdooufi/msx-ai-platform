# ─────────────────────────────────────────────────────────────────────
# MSX AI Platform — backup script (Windows PowerShell)
#
# Backs up:
#   1. PostgreSQL (Chatboot DB)  → pg_dump custom format (needs pg tools in PATH)
#   2. Qdrant                    → snapshot per collection (stored by Qdrant
#                                  under .\data\qdrant\snapshots)
#   3. Uploaded documents        → zip of .\data\uploads
#
# Usage:            .\scripts\backup.ps1 [-BackupDir path]
# Task Scheduler:   powershell -ExecutionPolicy Bypass -File D:\python\msx-ai-platform\scripts\backup.ps1
#
# Set $env:PGPASSWORD before running — credentials are not stored here.
# ─────────────────────────────────────────────────────────────────────
param(
  [string]$BackupDir = "",
  [string]$QdrantUrl = "http://localhost:6333",
  [int]$KeepDays = 14
)

$ErrorActionPreference = 'Continue'
$Root  = Split-Path -Parent $PSScriptRoot
if (-not $BackupDir) { $BackupDir = Join-Path $Root 'backups' }
$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'

if (-not $env:PGHOST)     { $env:PGHOST = 'localhost' }
if (-not $env:PGPORT)     { $env:PGPORT = '5432' }
if (-not $env:PGUSER)     { $env:PGUSER = 'postgres' }
if (-not $env:PGDATABASE) { $env:PGDATABASE = 'Chatboot' }

New-Item -ItemType Directory -Force $BackupDir | Out-Null
Write-Host "-- MSX AI backup -> $BackupDir ($Stamp)"

# 1. PostgreSQL
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if ($pgDump) {
  Write-Host "-> pg_dump $($env:PGDATABASE)"
  & pg_dump --format=custom --file "$BackupDir\pg_$($env:PGDATABASE)_$Stamp.dump"
} else {
  Write-Warning "pg_dump not found in PATH - skipping Postgres backup"
}

# 2. Qdrant snapshots
Write-Host "-> Qdrant snapshots"
try {
  $cols = (Invoke-RestMethod "$QdrantUrl/collections").result.collections
  foreach ($c in $cols) {
    Write-Host "   snapshot: $($c.name)"
    try { Invoke-RestMethod -Method Post "$QdrantUrl/collections/$($c.name)/snapshots" | Out-Null }
    catch { Write-Warning "   snapshot failed for $($c.name)" }
  }
} catch {
  Write-Warning "Qdrant unreachable at $QdrantUrl - skipping snapshots"
}

# 3. Uploaded documents
$uploads = Join-Path $Root 'data\uploads'
if (Test-Path $uploads) {
  Write-Host "-> uploads archive"
  Compress-Archive -Path $uploads -DestinationPath "$BackupDir\uploads_$Stamp.zip" -Force
}

# 4. Retention
Write-Host "-> pruning backups older than $KeepDays days"
Get-ChildItem $BackupDir -File |
  Where-Object { $_.Name -match '^(pg_.*\.dump|uploads_.*\.zip)$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Force

Write-Host "Backup complete"
