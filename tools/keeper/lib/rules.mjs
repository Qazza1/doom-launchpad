function alert(id, severity, title, summary, details, action) {
  return { id, severity, title, summary, details, action };
}

function addComponentMismatches(alerts, componentName, componentState) {
  if (!componentState?.hasCode) return;
  for (const [field, expected] of Object.entries(componentState.expected ?? {})) {
    const actual = componentState.actual?.[field];
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
      alerts.push(
        alert(
          `${componentName}:mismatch:${field}`,
          "critical",
          `${componentName} ${field} mismatch`,
          "The deployed value differs from the keeper manifest.",
          [`Expected: ${expected}`, `Actual: ${actual}`],
          "Keep launches paused and verify the tagged deployment manifest.",
        ),
      );
    }
  }
}

export function evaluateKeeperState(state, config) {
  const alerts = [];
  const now = state.observedAt;
  const thresholds = config.thresholds;

  if (state.chainId !== config.chainId) {
    alerts.push(
      alert(
        "rpc:wrong-chain",
        "critical",
        "Keeper connected to the wrong chain",
        `Expected chain ${config.chainId}, received ${state.chainId}.`,
        [],
        "Disable the keeper and correct the RPC URL.",
      ),
    );
    return alerts;
  }

  const rpcAge = now - state.headTimestamp;
  if (rpcAge < -thresholds.rpcFutureToleranceSeconds) {
    alerts.push(
      alert(
        "rpc:future-head",
        "critical",
        "Robinhood block timestamp is in the future",
        `Latest block timestamp is ${-rpcAge} seconds ahead of the keeper clock.`,
        [`Head block: ${state.headNumber}`],
        "Check the keeper host clock and confirm the block through a second RPC.",
      ),
    );
  }
  if (rpcAge > thresholds.rpcStaleSeconds) {
    alerts.push(
      alert(
        "rpc:stale-head",
        "critical",
        "Robinhood RPC head is stale",
        `Latest block timestamp is ${rpcAge} seconds behind the keeper clock.`,
        [`Head block: ${state.headNumber}`],
        "Check the primary and fallback RPCs before trusting deadline data.",
      ),
    );
  }

  if (!state.factory?.hasCode) {
    alerts.push(
      alert(
        "factory:no-code",
        "critical",
        "Factory bytecode is missing",
        "The configured factory address has no contract code.",
        [state.factory?.address ?? "No factory address"],
        "Keep launches paused and verify the deployment manifest.",
      ),
    );
    return alerts;
  }

  for (const [field, expected] of Object.entries(state.factory.expected ?? {})) {
    const actual = state.factory.actual?.[field];
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
      alerts.push(
        alert(
          `factory:mismatch:${field}`,
          "critical",
          `Factory ${field} mismatch`,
          "The deployed immutable value differs from the keeper manifest.",
          [`Expected: ${expected}`, `Actual: ${actual}`],
          "Do not resume launches; verify bytecode, constructor arguments, and configuration.",
        ),
      );
    }
  }

  if (state.factory.launchesPaused !== config.expectedFactoryPaused) {
    alerts.push(
      alert(
        "factory:pause-state",
        "critical",
        "Unexpected factory pause state",
        `Expected launchesPaused=${config.expectedFactoryPaused}, observed ${state.factory.launchesPaused}.`,
        [],
        config.expectedFactoryPaused
          ? "Ask the emergency guardian or operator to pause new launches."
          : "Verify the operator intended this pause before changing anything.",
      ),
    );
  }

  if (!state.positionLocker?.hasCode) {
    alerts.push(
      alert(
        "locker:no-code",
        "critical",
        "Position locker bytecode is missing",
        "The configured permanent locker address has no contract code.",
        [],
        "Keep launches paused and verify the deployment manifest.",
      ),
    );
  }

  if (!state.doomRewards?.hasCode) {
    alerts.push(
      alert(
        "rewards:no-code",
        "critical",
        "DoomRewards bytecode is missing",
        "The configured reward vault address has no contract code.",
        [],
        "Keep launches paused and verify the deployment manifest.",
      ),
    );
  }
  addComponentMismatches(alerts, "locker", state.positionLocker);
  addComponentMismatches(alerts, "rewards", state.doomRewards);
  for (const balance of state.doomRewards?.balances ?? []) {
    const accounted = BigInt(balance.availableRewards) + BigInt(balance.reservedRewards);
    if (BigInt(balance.actualBalance) !== accounted) {
      alerts.push(
        alert(
          `rewards:balance:${balance.token.toLowerCase()}`,
          "critical",
          "DoomRewards accounting mismatch",
          "The vault token balance does not equal available plus reserved rewards.",
          [
            `Token: ${balance.token}`,
            `Actual: ${balance.actualBalance}`,
            `Available: ${balance.availableRewards}`,
            `Reserved: ${balance.reservedRewards}`,
          ],
          "Keep campaign creation paused and investigate deposits, claims, and direct transfers.",
        ),
      );
    }
  }

  for (const launch of state.launches ?? []) {
    const prefix = `launch:${launch.launchId}`;
    if (!launch.liquidityPermanent || !launch.currentlyLocked) {
      alerts.push(
        alert(
          `${prefix}:lock`,
          "critical",
          `Launch ${launch.launchId} permanent lock check failed`,
          "The launch record or live position ownership is not permanently locked.",
          [`Position: ${launch.positionId}`, `Token: ${launch.token}`],
          "Pause new launches and independently inspect the position NFT owner.",
        ),
      );
    }

    if (launch.escrowStatus === 0) {
      if (now > launch.nextDeadline) {
        alerts.push(
          alert(
            `${prefix}:default-finalizable`,
            "critical",
            `Launch ${launch.launchId} missed its GM deadline`,
            "The creator commitment is still active but can now be permissionlessly defaulted.",
            [`Escrow: ${launch.creatorEscrow}`, `Deadline: ${new Date(launch.nextDeadline * 1000).toISOString()}`],
            "Review the escrow on the explorer, then call finalizeDefault from a normal wallet if appropriate.",
          ),
        );
      } else if (now >= launch.nextCheckInAt) {
        const secondsRemaining = launch.nextDeadline - now;
        alerts.push(
          alert(
            `${prefix}:gm-window`,
            secondsRemaining <= thresholds.gmCriticalLeadSeconds ? "critical" : "warning",
            `Launch ${launch.launchId} GM window is open`,
            `${secondsRemaining} seconds remain before the deadline.`,
            [
              `Completed: ${launch.completedCheckIns}/${launch.requiredCheckIns}`,
              `Creator: ${launch.creator}`,
              `Escrow: ${launch.creatorEscrow}`,
            ],
            "The creator should submit recordGm before the on-chain deadline.",
          ),
        );
      } else if (launch.nextCheckInAt - now <= thresholds.gmReminderLeadSeconds) {
        alerts.push(
          alert(
            `${prefix}:gm-reminder`,
            "info",
            `Launch ${launch.launchId} GM check-in approaches`,
            `The next GM window opens in ${launch.nextCheckInAt - now} seconds.`,
            [`Creator: ${launch.creator}`, `Escrow: ${launch.creatorEscrow}`],
            "Prepare the creator wallet for the upcoming recordGm transaction.",
          ),
        );
      }
    }

    const feeReference = launch.lastFeeCollectionAt ?? launch.createdAt;
    if (now - feeReference >= thresholds.feeCollectionReminderSeconds) {
      alerts.push(
        alert(
          `${prefix}:fee-collection`,
          "info",
          `Launch ${launch.launchId} fee collection is due for review`,
          `${now - feeReference} seconds have elapsed since launch or the last collection.`,
          [`Position: ${launch.positionId}`],
          "Simulate collectFees and call it permissionlessly only after reviewing the result.",
        ),
      );
    }
  }

  return alerts.sort((left, right) => left.id.localeCompare(right.id));
}
