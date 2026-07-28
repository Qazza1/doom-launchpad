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

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$workspaceForge = Join-Path $PSScriptRoot "..\..\..\.tools\foundry-v1.7.1\forge.exe"
$userForge = Join-Path $env:USERPROFILE ".foundry\bin\forge.exe"

$forgeCommand = Get-Command forge -ErrorAction SilentlyContinue
if ($null -ne $forgeCommand) {
    $forgePath = $forgeCommand.Source
} elseif (Test-Path -LiteralPath $workspaceForge) {
    $forgePath = (Resolve-Path $workspaceForge).Path
} elseif (Test-Path -LiteralPath $userForge) {
    $forgePath = (Resolve-Path $userForge).Path
} else {
    throw "Foundry forge was not found. Restore the workspace-local Foundry v1.7.1 binaries."
}

$primarySecure = Read-Host "Primary Robinhood Mainnet HTTPS RPC URL" -AsSecureString
$primary = ConvertFrom-Secret $primarySecure

try {
    if ([string]::IsNullOrWhiteSpace($primary)) {
        throw "The primary RPC URL is required."
    }
    $parsed = [Uri]$primary
    if ($parsed.Scheme -ne "https") {
        throw "The primary RPC must use HTTPS."
    }

    $env:ROBINHOOD_RPC_URL = $primary
    $env:RUN_ROBINHOOD_FORK_TESTS = "true"
    $env:ROBINHOOD_REHEARSAL_ACK = "true"

    Push-Location $projectRoot
    try {
        & $forgePath test `
            --match-path "test/fork/*.t.sol" `
            -vv
        if ($LASTEXITCODE -ne 0) {
            throw "The opt-in Robinhood mainnet fork tests failed."
        }

        & $forgePath script `
            "script/DeployRobinhoodCanaryRehearsal.s.sol:DeployRobinhoodCanaryRehearsal" `
            --rpc-url robinhood_mainnet `
            -vvv
        if ($LASTEXITCODE -ne 0) {
            throw "The non-broadcast fork rehearsal failed."
        }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:RUN_ROBINHOOD_FORK_TESTS -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_REHEARSAL_ACK -ErrorAction SilentlyContinue
    $primary = $null
    $primarySecure.Dispose()
}

Write-Host ""
Write-Host "Both Robinhood mainnet fork tests and the non-broadcast deployment rehearsal passed."
Write-Host "No signer or private key was loaded."
Write-Host "No transaction was signed, stored, or broadcast."
