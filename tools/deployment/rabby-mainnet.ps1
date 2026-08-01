param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 6)]
    [int]$Step
)

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

$approvalPath = Join-Path $PSScriptRoot "output\funding\owner-approval.json"
if (-not (Test-Path -LiteralPath $approvalPath)) {
    throw "The recorded owner approval was not found. Nothing can be submitted."
}
$approval = Get-Content -Raw -LiteralPath $approvalPath | ConvertFrom-Json
$expectedText = "DEPLOY STEP $Step"

Write-Host "Robinhood MAINNET transaction $Step of 6."
Write-Host "This will open a local page that can ask Rabby to submit exactly one approved transaction."
Write-Host "It never loads a private key and cannot submit any later step."
Write-Host "Factory resume and token launch are not implemented in this tool."
$confirmation = Read-Host "Type '$expectedText' to continue"
if ($confirmation -cne $expectedText) {
    throw "Confirmation did not match. Nothing was submitted."
}

$primarySecure = Read-Host "Primary Robinhood Mainnet HTTPS RPC URL" -AsSecureString
$fallbackSecure = Read-Host "Fallback Robinhood Mainnet HTTPS RPC URL" -AsSecureString
$primary = ConvertFrom-Secret $primarySecure
$fallback = ConvertFrom-Secret $fallbackSecure

try {
    $env:ROBINHOOD_RPC_URL = $primary
    $env:ROBINHOOD_FALLBACK_RPC_URL = $fallback
    $env:DOOM_MAINNET_EXECUTION_ACK = $approval.planSha256
    & node (Join-Path $PSScriptRoot "rabby-mainnet-server.mjs") --step ($Step - 1)
    if ($LASTEXITCODE -ne 0) {
        throw "The locked mainnet step server failed or refused to start."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_FALLBACK_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DOOM_MAINNET_EXECUTION_ACK -ErrorAction SilentlyContinue
    $primary = $null
    $fallback = $null
    $primarySecure.Dispose()
    $fallbackSecure.Dispose()
}
