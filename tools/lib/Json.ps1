# Dot-source this file before reading or writing JSON from a PowerShell script:
#
#   . (Join-Path $PSScriptRoot "..\lib\Json.ps1")
#
# Windows PowerShell 5.1 writes a UTF-8 byte-order mark for `-Encoding utf8`, and both
# `JSON.parse` in Node and some parsers reject the resulting file at character 0 with an error that
# never mentions the BOM. Never use `Out-File -Encoding utf8`, `Set-Content -Encoding utf8`, or `>`
# for a file another tool parses. Use these helpers instead.

Set-StrictMode -Version Latest

function Write-Utf8NoBomFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    # Resolve to an absolute path: .NET writes relative to the process directory, which is not the
    # PowerShell current location.
    $full = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Path))
    if ([System.IO.Path]::IsPathRooted($Path)) { $full = $Path }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    # Temporary file then move, so an interrupted write cannot leave a truncated file behind.
    $temporary = "$full.$PID.tmp"
    try {
        [System.IO.File]::WriteAllText($temporary, $Text, $encoding)
        Move-Item -LiteralPath $temporary -Destination $full -Force
    } catch {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        throw
    }
    return $full
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 32
    )

    $text = ($Value | ConvertTo-Json -Depth $Depth)
    return Write-Utf8NoBomFile -Path $Path -Text "$text`n"
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $text = Get-Content -LiteralPath $Path -Raw
    if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) {
        $text = $text.Substring(1)
    }
    return $text | ConvertFrom-Json
}
