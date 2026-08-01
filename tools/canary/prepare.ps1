param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("resume", "launch")]
    [string]$Kind,

    [ValidateRange(1, 3)]
    [int]$Launch = 1,

    [ValidateRange(1, 3600)]
    [int]$Ttl = 900
)

$ErrorActionPreference = "Stop"

function Read-SecretText {
    param([string]$Prompt)
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

Write-Host "Preparing a $Kind plan. This reads chain state and prints a plan hash."
Write-Host "It cannot send a transaction. Submitting is done in your own wallet,"
Write-Host "after comparing the hash, as a separate decision."
Write-Host ""
Write-Host "The two endpoints must be independent providers, for example Alchemy"
Write-Host "and QuickNode. They are read through hidden prompts and never stored."

$primary = Read-SecretText "Primary HTTPS RPC URL"
$fallback = Read-SecretText "Fallback HTTPS RPC URL (different provider)"

try {
    $env:ROBINHOOD_RPC_URL = $primary
    $env:ROBINHOOD_FALLBACK_RPC_URL = $fallback
    & node (Join-Path $PSScriptRoot "prepare.mjs") --kind $Kind --launch $Launch --ttl $Ttl
    if ($LASTEXITCODE -ne 0) {
        throw "Preparation failed. Nothing was sent. Resolve every guard failure before retrying."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_FALLBACK_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
    $fallback = $null
}

Write-Host ""
Write-Host "Endpoints cleared from this session. No transaction was signed or broadcast."
