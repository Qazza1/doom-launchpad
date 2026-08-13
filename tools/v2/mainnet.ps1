param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 7)]
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

$approvalPath = Join-Path $PSScriptRoot "..\..\config\v2-mainnet-deployment-authorization.json"
if (-not (Test-Path -LiteralPath $approvalPath)) {
    throw "The exact V2 owner authorization was not found. Nothing can be submitted."
}
$approval = Get-Content -Raw -LiteralPath $approvalPath | ConvertFrom-Json
$expectedText = "DEPLOY V2 STEP $Step"

Write-Host "Robinhood MAINNET V2 transaction $Step of 7."
Write-Host "This opens a local page that can ask Rabby to submit exactly one authorized transaction."
Write-Host "It never loads a private key and cannot submit any later step."
Write-Host "Factory activation and token launch are not implemented in this tool."
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
    $env:DOOM_V2_MAINNET_EXECUTION_ACK = $approval.planSha256
    & node (Join-Path $PSScriptRoot "mainnet-server.mjs") --step ($Step - 1)
    if ($LASTEXITCODE -ne 0) {
        throw "The locked V2 mainnet step server failed or refused to start."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_FALLBACK_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DOOM_V2_MAINNET_EXECUTION_ACK -ErrorAction SilentlyContinue
    $primary = $null
    $fallback = $null
    $primarySecure.Dispose()
    $fallbackSecure.Dispose()
}
