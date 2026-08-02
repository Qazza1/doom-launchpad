param(
    [switch]$RunRobinhoodForkTests
)

$ErrorActionPreference = "Stop"

function Assert-ContractSize {
    param(
        [string]$ForgePath,
        [string]$ContractName,
        [int]$MaximumBytes
    )

    $bytecode = (& $ForgePath inspect $ContractName deployedBytecode).Trim()
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($bytecode.StartsWith("0x")) {
        $bytecode = $bytecode.Substring(2)
    }
    $byteCount = [int]($bytecode.Length / 2)
    Write-Host "$ContractName runtime: $byteCount bytes (limit: $MaximumBytes)"
    if ($byteCount -gt $MaximumBytes) {
        throw "$ContractName exceeds the audit-candidate size budget."
    }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $projectRoot "config\robinhood-mainnet-canary.decisions.json"
$workspaceForge = Join-Path $PSScriptRoot "..\..\.tools\foundry-v1.7.1\forge.exe"
$userForge = Join-Path $env:USERPROFILE ".foundry\bin\forge.exe"

$forgeCommand = Get-Command forge -ErrorAction SilentlyContinue
if ($null -ne $forgeCommand) {
    $forgePath = $forgeCommand.Source
} elseif (Test-Path -LiteralPath $workspaceForge) {
    $forgePath = (Resolve-Path $workspaceForge).Path
} elseif (Test-Path -LiteralPath $userForge) {
    $forgePath = (Resolve-Path $userForge).Path
} else {
    throw "Foundry was not found. Install Foundry or restore the workspace-local v1.7.1 binary."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    throw "npm.cmd was not found. Install Node.js 22 or newer."
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw "node was not found. Install Node.js 22 or newer."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.network.chainId -ne 4663) {
    throw "Unexpected chain ID in mainnet canary manifest."
}
if ($manifest.deploymentSafety.enabled -ne $false -or
    $manifest.deploymentSafety.broadcast -ne $false -or
    $manifest.deploymentSafety.mainnetDeploymentApproved -ne $false) {
    throw "Mainnet canary manifest is not fail-closed. Refusing to continue."
}
if ($manifest.creationFee.feeBps -ne 100 -or
    $manifest.creationFee.treasuryShareBps -ne 5000 -or
    $manifest.creationFee.nftRewardsShareBps -ne 5000 -or
    $manifest.tokenEconomics.creatorLiquidBps -ne 0 -or
    $manifest.tokenEconomics.liquidityBps -ne 4000 -or
    $manifest.tokenEconomics.gmEscrowBps -ne 6000 -or
    $manifest.gmCommitment.requiredCheckIns -ne 3 -or
    $manifest.gmCommitment.cadenceSeconds -ne 86400 -or
    $manifest.gmCommitment.gracePeriodSeconds -ne 43200 -or
    $manifest.liquidity.eligibleWethFeeSplitBps.creator -ne 7000 -or
    $manifest.liquidity.eligibleWethFeeSplitBps.treasury -ne 1500 -or
    $manifest.liquidity.eligibleWethFeeSplitBps.doomRewards -ne 1500 -or
    $manifest.liquidity.ineligibleWethFeeSplitBps.creator -ne 0 -or
    $manifest.liquidity.ineligibleWethFeeSplitBps.treasury -ne 1500 -or
    $manifest.liquidity.ineligibleWethFeeSplitBps.doomRewards -ne 8500 -or
    $manifest.liquidity.poolFee -ne 10000 -or
    $manifest.liquidity.releaseSupported -ne $false -or
    $manifest.pilotLimits.maxLaunches -ne 3 -or
    $manifest.pilotLimits.maxNativeLiquidityPerLaunchWei -ne "10000000000000000" -or
    $manifest.pilotLimits.maxNativeLiquidityGlobalWei -ne "30000000000000000") {
    throw "Economics in the manifest do not match the frozen canary."
}

Write-Host "Manifest valid and deployment remains disabled."
$deploymentTests = Get-ChildItem -LiteralPath (Join-Path $projectRoot "tools\deployment\test") `
    -Filter "*.test.mjs" | ForEach-Object { $_.FullName }
& $nodeCommand.Source --test $deploymentTests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeCommand.Source (Join-Path $projectRoot "tools\deployment\verify-manifest.mjs") `
    (Join-Path $projectRoot "config\stage4-deployment-manifest.json")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$libraryTests = Get-ChildItem -LiteralPath (Join-Path $projectRoot "tools\lib\test") `
    -Filter "*.test.mjs" | ForEach-Object { $_.FullName }
& $nodeCommand.Source --test $libraryTests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$reviewTests = Get-ChildItem -LiteralPath (Join-Path $projectRoot "tools\review\test") `
    -Filter "*.test.mjs" | ForEach-Object { $_.FullName }
& $nodeCommand.Source --test $reviewTests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$canaryTests = Get-ChildItem -LiteralPath (Join-Path $projectRoot "tools\canary\test") `
    -Filter "*.test.mjs" | ForEach-Object { $_.FullName }
& $nodeCommand.Source --test $canaryTests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$deathWatchTests = Get-ChildItem -LiteralPath (Join-Path $projectRoot "tools\deathwatch\test") `
    -Filter "*.test.mjs" | ForEach-Object { $_.FullName }
& $nodeCommand.Source --test $deathWatchTests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Documentation and config claims against live chain state. Skips itself when no endpoint is
# configured, because CI has no secrets and a check that cannot run must say so rather than block
# every build. It is loud about skipping; do not read a skip as agreement.
& $nodeCommand.Source (Join-Path $projectRoot "tools\check-state-drift.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $forgePath --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location $projectRoot
try {
    & $forgePath fmt --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $forgePath test -vv
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # Reads the compiled ABIs, so it must run after the build rather than with the other Node tests.
    $integrationTests = Get-ChildItem -LiteralPath (Join-Path $projectRoot "tools\integration\test") `
        -Filter "*.test.mjs" | ForEach-Object { $_.FullName }
    & $nodeCommand.Source --test $integrationTests
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $npmCommand.Source test --prefix (Join-Path $projectRoot "tools\rewards")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $npmCommand.Source test --prefix (Join-Path $projectRoot "tools\keeper")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Assert-ContractSize $forgePath "DoomLaunchFactory" 23500
    Assert-ContractSize $forgePath "V3LiquidityManager" 12000
    Assert-ContractSize $forgePath "PositionLocker" 12000

    if ($RunRobinhoodForkTests) {
        $previousForkSetting = $env:RUN_ROBINHOOD_FORK_TESTS
        try {
            $env:RUN_ROBINHOOD_FORK_TESTS = "true"
            & $forgePath test --match-path "test/fork/*.t.sol" -vv
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } finally {
            if ($null -eq $previousForkSetting) {
                Remove-Item Env:RUN_ROBINHOOD_FORK_TESTS -ErrorAction SilentlyContinue
            } else {
                $env:RUN_ROBINHOOD_FORK_TESTS = $previousForkSetting
            }
        }
    }
} finally {
    Pop-Location
}
