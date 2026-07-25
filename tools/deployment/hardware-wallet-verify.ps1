param(
    [ValidateSet("ledger", "trezor")]
    [string]$Device,
    [string]$DerivationPath
)

$ErrorActionPreference = "Stop"
$expectedAddress = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F"
$workspaceCast = Join-Path $PSScriptRoot "..\..\..\.tools\foundry-v1.7.1\cast.exe"
$userCast = Join-Path $env:USERPROFILE ".foundry\bin\cast.exe"

$castCommand = Get-Command cast -ErrorAction SilentlyContinue
if ($null -ne $castCommand) {
    $castPath = $castCommand.Source
} elseif (Test-Path -LiteralPath $workspaceCast) {
    $castPath = (Resolve-Path $workspaceCast).Path
} elseif (Test-Path -LiteralPath $userCast) {
    $castPath = (Resolve-Path $userCast).Path
} else {
    throw "Foundry cast was not found. Restore the workspace-local Foundry v1.7.1 binaries."
}

if ([string]::IsNullOrWhiteSpace($Device)) {
    $Device = (Read-Host "Hardware wallet type (ledger or trezor)").Trim().ToLowerInvariant()
}
if ($Device -notin @("ledger", "trezor")) {
    throw "Unsupported hardware wallet. Enter ledger or trezor."
}

$deviceFlag = if ($Device -eq "ledger") { "--ledger" } else { "--trezor" }
$walletArguments = @($deviceFlag)
if (-not [string]::IsNullOrWhiteSpace($DerivationPath)) {
    $walletArguments += @("--mnemonic-derivation-path", $DerivationPath)
}

Write-Host ""
Write-Host "Open the Ethereum app on the hardware wallet."
Write-Host "Close Ledger Live, MetaMask, Trezor Suite, or any app currently using the device."
Write-Host "The expected deployment address is $expectedAddress"
Write-Host ""

$derivedAddress = (& $castPath wallet address @walletArguments).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Could not read the hardware-wallet address."
}
if ($derivedAddress -notmatch "^0x[0-9a-fA-F]{40}$") {
    throw "The hardware wallet returned an unexpected address value."
}
if ($derivedAddress.ToLowerInvariant() -ne $expectedAddress.ToLowerInvariant()) {
    throw "Hardware-wallet address mismatch. Expected $expectedAddress but received $derivedAddress. Stop here."
}

$challengeId = [Guid]::NewGuid().ToString("N")
$message = @"
DoomStreak Stage 4 hardware-wallet control check
Chain: Robinhood Chain Mainnet (4663)
Deployer: $expectedAddress
Challenge: $challengeId
Purpose: prove wallet control only
This is not a transaction and authorizes no deployment.
"@.Trim()

Write-Host "Address matched. Approve the message-signing request on the device."
$signature = (& $castPath wallet sign @walletArguments $message).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "The hardware wallet did not sign the control-check message."
}
if ($signature -notmatch "^0x[0-9a-fA-F]{130}$") {
    throw "The hardware wallet returned an unexpected signature value."
}

$verificationOutput = (& $castPath wallet verify --address $expectedAddress $message $signature 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw "The hardware-wallet signature did not verify for the expected deployer address."
}

$signature = $null
$message = $null
$verificationOutput = $null

Write-Host ""
Write-Host "Hardware-wallet control verification passed."
Write-Host "Device type: $Device"
Write-Host "Verified deployer: $expectedAddress"
Write-Host "No transaction was created, signed, stored, or broadcast."
