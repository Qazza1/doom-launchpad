$ErrorActionPreference = "Stop"

function ConvertFrom-Secret {
    param([Security.SecureString]$Secret)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw "Node.js 22 or newer was not found."
}

$primarySecure = Read-Host "Alchemy Robinhood Mainnet HTTPS URL" -AsSecureString
$primary = ConvertFrom-Secret $primarySecure

try {
    $env:ROBINHOOD_RPC_URL = $primary
    & $nodeCommand.Source (Join-Path $PSScriptRoot "localhost-preview.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "The six-transaction localhost preview failed."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
    $primarySecure.Dispose()
}
