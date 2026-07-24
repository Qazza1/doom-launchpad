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

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.network.chainId -ne 4663) {
    throw "Unexpected chain ID in mainnet canary manifest."
}
if ($manifest.deploymentSafety.enabled -ne $false -or
    $manifest.deploymentSafety.broadcast -ne $false -or
    $manifest.deploymentSafety.mainnetDeploymentApproved -ne $false) {
    throw "Mainnet canary manifest is not fail-closed. Refusing to continue."
}
if ($manifest.creationFee.feeBps -ne 300 -or
    $manifest.liquidity.poolFee -ne 10000 -or
    $manifest.liquidity.releaseSupported -ne $false -or
    $manifest.pilotLimits.maxNativeLiquidityPerLaunchWei -ne "10000000000000000") {
    throw "Stage 3.1 economics in the manifest do not match the frozen canary."
}

Write-Host "Manifest valid and deployment remains disabled."
& $forgePath --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location $projectRoot
try {
    & $forgePath fmt --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $forgePath test -vv
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
