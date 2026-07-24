param(
    [switch]$RunRobinhoodForkTests
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $projectRoot "config\robinhood-mainnet-canary.decisions.json"
$workspaceForge = Join-Path $PSScriptRoot "..\..\.tools\foundry-v1.7.1\forge.exe"

$forgeCommand = Get-Command forge -ErrorAction SilentlyContinue
if ($null -ne $forgeCommand) {
    $forgePath = $forgeCommand.Source
} elseif (Test-Path -LiteralPath $workspaceForge) {
    $forgePath = (Resolve-Path $workspaceForge).Path
} else {
    throw "Foundry was not found. Install Foundry or restore the workspace-local v1.7.1 binary."
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

Write-Host "Manifest valid and deployment remains disabled."
& $forgePath --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location $projectRoot
try {
    & $forgePath fmt --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & $forgePath test -vv
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

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
