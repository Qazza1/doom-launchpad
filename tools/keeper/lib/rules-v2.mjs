function alert(id, severity, title, summary, details, action) {
  return { id, severity, title, summary, details, action };
}

export function evaluateKeeperStateV2(state, config) {
  const alerts = [];
  const now = state.observedAt;
  const thresholds = config.thresholds;
  if (state.chainId !== config.chainId) {
    return [alert("rpc:wrong-chain", "critical", "Keeper connected to the wrong chain", `Expected ${config.chainId}, received ${state.chainId}.`, [], "Correct the RPC URL immediately.")];
  }
  const rpcAge = now - state.headTimestamp;
  if (rpcAge > thresholds.rpcStaleSeconds) alerts.push(alert("rpc:stale-head", "critical", "Robinhood RPC head is stale", `Latest block is ${rpcAge} seconds behind the keeper clock.`, [`Head: ${state.headNumber}`], "Check both RPC providers before trusting launch state."));
  if (rpcAge < -thresholds.rpcFutureToleranceSeconds) alerts.push(alert("rpc:future-head", "critical", "Robinhood block timestamp is in the future", `Latest block is ${-rpcAge} seconds ahead.`, [`Head: ${state.headNumber}`], "Check the host clock and a second RPC."));
  if (!state.factory?.hasCode) return [...alerts, alert("factory:no-code", "critical", "V2 factory bytecode is missing", "The configured V2 factory has no code.", [state.factory?.address || "unknown"], "Keep launches paused and verify the deployment record.")];

  for (const [field, expected] of Object.entries(state.factory.expected || {})) {
    const actual = state.factory.actual?.[field];
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
      alerts.push(alert(`factory:mismatch:${field}`, "critical", `V2 factory ${field} mismatch`, "A deployed immutable or limit differs from the frozen manifest.", [`Expected: ${expected}`, `Actual: ${actual}`], "Pause launches and verify the deployed bytecode and constructor inputs."));
    }
  }
  if (!state.factory.configurationValid) alerts.push(alert("factory:configuration-invalid", "critical", "V2 factory binding health failed", "isLaunchConfigurationValid() returned false.", [], "Keep launches paused and inspect all one-time bindings."));
  if (config.creatorPolicy !== "permissionless_eoa" && !state.factory.initialCreatorAllowed) alerts.push(alert("factory:creator-disabled", "critical", "Initial V2 creator is not allowlisted", "The approved beta creator is disabled.", [config.expectedRoles.approvedCreator], "Do not launch until the operator intentionally restores the expected permission."));
  if (state.factory.launchesPaused !== config.expectedFactoryPaused) alerts.push(alert("factory:pause-state", "critical", "Unexpected V2 factory pause state", `Expected launchesPaused=${config.expectedFactoryPaused}, observed ${state.factory.launchesPaused}.`, [], config.expectedFactoryPaused ? "Ask the guardian or operator to pause immediately." : "Confirm whether an emergency pause was intentional."));

  for (const [name, hasCode] of Object.entries(state.components?.code || {})) {
    if (!hasCode) alerts.push(alert(`component:no-code:${name}`, "critical", `V2 ${name} bytecode is missing`, "A required V2 dependency has no runtime code.", [config.contracts[name]], "Pause launches and verify the deployment record."));
  }
  if (String(state.components?.deployerAuthorizedFactory).toLowerCase() !== String(config.contracts.factory).toLowerCase()) alerts.push(alert("binding:deployer", "critical", "V2 curve deployer binding mismatch", "The curve deployer is not bound to the V2 factory.", [], "Keep launches paused."));
  const manager = state.components?.manager || {};
  const managerExpected = {
    authorizedFactory: config.contracts.factory, positionLocker: config.contracts.positionLocker,
    uniswapV3Factory: config.contracts.uniswapV3Factory, positionManager: config.contracts.nonfungiblePositionManager,
    wrappedNative: config.contracts.wrappedNative, expectedChainId: String(config.chainId),
  };
  for (const [field, expected] of Object.entries(managerExpected)) {
    if (String(manager[field]).toLowerCase() !== String(expected).toLowerCase()) alerts.push(alert(`binding:manager:${field}`, "critical", `V2 graduation manager ${field} mismatch`, "The canonical V3 graduation configuration differs from the manifest.", [`Expected: ${expected}`, `Actual: ${manager[field]}`], "Keep launches paused and inspect the manager."));
  }

  for (const launch of state.launches || []) {
    const prefix = `v2-launch:${launch.launchId}`;
    if (launch.graduated && (!launch.pool || launch.positionId === "0" || launch.currentlyLocked !== true)) alerts.push(alert(`${prefix}:lock`, "critical", `V2 launch ${launch.launchId} graduation lock failed`, "A graduated curve does not have a confirmed permanent V3 lock.", [`Curve: ${launch.curve}`, `Position: ${launch.positionId}`], "Pause new launches and inspect the graduation transaction."));
    if (launch.graduated && launch.escrowStatus === 0) alerts.push(alert(`${prefix}:escrow-pending`, "critical", `V2 launch ${launch.launchId} escrow was not activated`, "Graduation completed but the GM escrow remains pending.", [launch.escrow], "Pause new launches and inspect the atomic graduation path."));
    if (!launch.graduated && launch.escrowStatus !== 0) alerts.push(alert(`${prefix}:early-escrow`, "critical", `V2 launch ${launch.launchId} escrow activated early`, "The creator escrow changed state before graduation.", [launch.escrow], "Pause new launches and investigate."));
    if (launch.escrowStatus === 1 && launch.nextDeadline) {
      if (now > launch.nextDeadline) alerts.push(alert(`${prefix}:default-finalizable`, "critical", `V2 launch ${launch.launchId} missed its GM deadline`, "The active commitment can now be permissionlessly defaulted.", [`Deadline: ${new Date(launch.nextDeadline * 1000).toISOString()}`, `Escrow: ${launch.escrow}`], "Verify chain time, then finalize the default if appropriate."));
      else if (now >= launch.nextCheckInAt) alerts.push(alert(`${prefix}:gm-window`, launch.nextDeadline - now <= thresholds.gmCriticalLeadSeconds ? "critical" : "warning", `V2 launch ${launch.launchId} GM window is open`, `${launch.nextDeadline - now} seconds remain.`, [`Creator: ${launch.creator}`, `Completed: ${launch.completedCheckIns}/${launch.requiredCheckIns}`], "The creator should call recordGm before the deadline."));
      else if (launch.nextCheckInAt - now <= thresholds.gmReminderLeadSeconds) alerts.push(alert(`${prefix}:gm-reminder`, "info", `V2 launch ${launch.launchId} GM window approaches`, `The window opens in ${launch.nextCheckInAt - now} seconds.`, [launch.creator], "Prepare the creator wallet."));
    }
  }
  return alerts.sort((a, b) => a.id.localeCompare(b.id));
}
