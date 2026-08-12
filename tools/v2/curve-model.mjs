export const BPS_DENOMINATOR = 10_000n;
export const WEI_PER_ETH = 10n ** 18n;

export const RECOMMENDED_CURVE = Object.freeze({
  curveAllocationBps: 4_000n,
  gmEscrowBps: 6_000n,
  soldAtGraduationBps: 3_000n,
  v3LiquidityTokenBps: 1_000n,
  tradingFeeBps: 100n,
  graduationNetNativeWei: 50_000_000_000_000_000n,
});

function positive(value, name) {
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${name} must be positive`);
  return parsed;
}

export function mulDivDown(a, b, denominator) {
  if (denominator === 0n) throw new Error("division by zero");
  return a * b / denominator;
}

export function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator === 0n) return 0n;
  return (numerator - 1n) / denominator + 1n;
}

export function deriveCurveParameters(totalSupply, proposal = RECOMMENDED_CURVE) {
  const supply = positive(totalSupply, "totalSupply");
  const curveAllocationBps = BigInt(proposal.curveAllocationBps);
  const gmEscrowBps = BigInt(proposal.gmEscrowBps);
  const soldAtGraduationBps = BigInt(proposal.soldAtGraduationBps);
  const v3LiquidityTokenBps = BigInt(proposal.v3LiquidityTokenBps);
  const tradingFeeBps = BigInt(proposal.tradingFeeBps);
  const graduationNetNativeWei = positive(proposal.graduationNetNativeWei, "graduationNetNativeWei");

  if (curveAllocationBps + gmEscrowBps !== BPS_DENOMINATOR) {
    throw new Error("curve and GM allocations must equal 10000 bps");
  }
  if (soldAtGraduationBps + v3LiquidityTokenBps !== curveAllocationBps) {
    throw new Error("sold and V3 token allocations must equal the curve allocation");
  }
  if (soldAtGraduationBps <= v3LiquidityTokenBps) {
    throw new Error("price continuity requires sold allocation to exceed V3 token allocation");
  }
  if (tradingFeeBps <= 0n || tradingFeeBps >= BPS_DENOMINATOR) {
    throw new Error("trading fee must be between zero and 10000 bps");
  }

  const curveAllocation = mulDivDown(supply, curveAllocationBps, BPS_DENOMINATOR);
  const gmEscrow = supply - curveAllocation;
  const soldAtGraduation = mulDivDown(supply, soldAtGraduationBps, BPS_DENOMINATOR);
  const v3LiquidityTokens = curveAllocation - soldAtGraduation;
  const allocationDifference = soldAtGraduation - v3LiquidityTokens;

  // Constant-product continuity conditions:
  // xFinal = L*S/(S-L), xStart = xFinal+S, yStart = L*T/(S-L).
  const virtualTokenFinal = mulDivDown(v3LiquidityTokens, soldAtGraduation, allocationDifference);
  const virtualTokenStart = virtualTokenFinal + soldAtGraduation;
  const virtualNativeStart = mulDivDown(v3LiquidityTokens, graduationNetNativeWei, allocationDifference);
  const invariant = virtualTokenStart * virtualNativeStart;
  const terminalVirtualNative = virtualNativeStart + graduationNetNativeWei;

  const initialFdvWei = mulDivDown(virtualNativeStart, supply, virtualTokenStart);
  const terminalCurveFdvWei = mulDivDown(terminalVirtualNative, supply, virtualTokenFinal);
  const terminalV3FdvWei = mulDivDown(graduationNetNativeWei, supply, v3LiquidityTokens);

  return {
    totalSupply: supply,
    curveAllocation,
    gmEscrow,
    soldAtGraduation,
    v3LiquidityTokens,
    tradingFeeBps,
    graduationNetNativeWei,
    virtualTokenStart,
    virtualTokenFinal,
    virtualNativeStart,
    terminalVirtualNative,
    invariant,
    initialFdvWei,
    terminalCurveFdvWei,
    terminalV3FdvWei,
  };
}

export function createCurveState(totalSupply, proposal = RECOMMENDED_CURVE) {
  const parameters = deriveCurveParameters(totalSupply, proposal);
  return {
    ...parameters,
    virtualTokenReserve: parameters.virtualTokenStart,
    virtualNativeReserve: parameters.virtualNativeStart,
    realTokenReserve: parameters.curveAllocation,
    realNativeReserve: 0n,
    accruedTradingFees: 0n,
    graduated: false,
  };
}

function assertOpen(state) {
  if (state.graduated) throw new Error("curve has graduated");
}

function buyFee(grossNativeWei, feeBps) {
  return mulDivDown(grossNativeWei, feeBps, BPS_DENOMINATOR);
}

function grossForExactNet(netNativeWei, feeBps) {
  return netNativeWei + ceilDiv(netNativeWei * feeBps, BPS_DENOMINATOR - feeBps);
}

export function buy(state, grossNativeWei) {
  assertOpen(state);
  const grossOffered = positive(grossNativeWei, "grossNativeWei");
  const remainingToGraduate = state.graduationNetNativeWei - state.realNativeReserve;
  const ordinaryFee = buyFee(grossOffered, state.tradingFeeBps);
  const ordinaryNet = grossOffered - ordinaryFee;

  let grossUsed = grossOffered;
  let netNative = ordinaryNet;
  let fee = ordinaryFee;
  if (ordinaryNet >= remainingToGraduate) {
    netNative = remainingToGraduate;
    grossUsed = grossForExactNet(netNative, state.tradingFeeBps);
    if (grossUsed > grossOffered) throw new Error("gross input cannot fund the remaining net target");
    fee = grossUsed - netNative;
  }
  if (netNative === 0n) throw new Error("buy is too small after fees");

  const virtualNativeReserve = state.virtualNativeReserve + netNative;
  const virtualTokenReserve = ceilDiv(state.invariant, virtualNativeReserve);
  const tokenOut = state.virtualTokenReserve - virtualTokenReserve;
  if (tokenOut <= 0n) throw new Error("buy is too small to return tokens");
  if (tokenOut > state.realTokenReserve) throw new Error("curve token inventory exhausted");

  const realNativeReserve = state.realNativeReserve + netNative;
  const realTokenReserve = state.realTokenReserve - tokenOut;
  const graduated = realNativeReserve === state.graduationNetNativeWei;
  if (graduated && realTokenReserve < state.v3LiquidityTokens) {
    throw new Error("graduation would underfund the V3 token side");
  }

  return {
    nextState: {
      ...state,
      virtualTokenReserve,
      virtualNativeReserve,
      realTokenReserve,
      realNativeReserve,
      accruedTradingFees: state.accruedTradingFees + fee,
      graduated,
    },
    grossOffered,
    grossUsed,
    refund: grossOffered - grossUsed,
    netNative,
    fee,
    tokenOut,
    graduated,
  };
}

export function sell(state, tokenIn) {
  assertOpen(state);
  const tokens = positive(tokenIn, "tokenIn");
  const soldSupply = state.curveAllocation - state.realTokenReserve;
  if (tokens > soldSupply) throw new Error("cannot sell more tokens than the curve distributed");

  const virtualTokenReserve = state.virtualTokenReserve + tokens;
  if (virtualTokenReserve > state.virtualTokenStart) {
    throw new Error("sell exceeds the initial virtual token reserve");
  }
  const virtualNativeReserve = ceilDiv(state.invariant, virtualTokenReserve);
  const grossNativeOut = state.virtualNativeReserve - virtualNativeReserve;
  if (grossNativeOut <= 0n) throw new Error("sell is too small to return native value");
  if (grossNativeOut > state.realNativeReserve) throw new Error("curve native reserve is insufficient");

  const fee = buyFee(grossNativeOut, state.tradingFeeBps);
  const netNativeOut = grossNativeOut - fee;
  return {
    nextState: {
      ...state,
      virtualTokenReserve,
      virtualNativeReserve,
      realTokenReserve: state.realTokenReserve + tokens,
      realNativeReserve: state.realNativeReserve - grossNativeOut,
      accruedTradingFees: state.accruedTradingFees + fee,
    },
    tokenIn: tokens,
    grossNativeOut,
    fee,
    netNativeOut,
  };
}

export function splitEligibleTradingFee(feeWei) {
  const fee = BigInt(feeWei);
  if (fee < 0n) throw new Error("fee cannot be negative");
  const creator = mulDivDown(fee, 7_000n, BPS_DENOMINATOR);
  const treasury = mulDivDown(fee, 1_500n, BPS_DENOMINATOR);
  const doomRewards = fee - creator - treasury;
  return { creator, treasury, doomRewards };
}

export function curveFdvWei(state) {
  return mulDivDown(state.virtualNativeReserve, state.totalSupply, state.virtualTokenReserve);
}

export function accounting(state) {
  return {
    tokenInventory: state.realTokenReserve,
    tokensDistributed: state.curveAllocation - state.realTokenReserve,
    nativeForGraduation: state.realNativeReserve,
    tradingFees: state.accruedTradingFees,
    totalNativeCustody: state.realNativeReserve + state.accruedTradingFees,
  };
}
