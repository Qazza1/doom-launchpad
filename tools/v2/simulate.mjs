import {
  RECOMMENDED_CURVE,
  WEI_PER_ETH,
  buy,
  createCurveState,
  curveFdvWei,
  deriveCurveParameters,
} from "./curve-model.mjs";

const TOKEN = 10n ** 18n;
const SUPPLY = 1_000_000_000n * TOKEN;

function eth(wei) {
  const whole = wei / WEI_PER_ETH;
  const fraction = String(wei % WEI_PER_ETH).padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function tokens(amount) {
  return (amount / TOKEN).toLocaleString("en-US");
}

const candidates = [
  [2_500n, 1_500n],
  [3_000n, 1_000n],
  [3_500n, 500n],
].map(([soldAtGraduationBps, v3LiquidityTokenBps]) => {
  const values = deriveCurveParameters(SUPPLY, {
    ...RECOMMENDED_CURVE,
    soldAtGraduationBps,
    v3LiquidityTokenBps,
  });
  return {
    split: `${Number(soldAtGraduationBps) / 100}% sold / ${Number(v3LiquidityTokenBps) / 100}% V3`,
    virtualNativeEth: eth(values.virtualNativeStart),
    initialFdvEth: eth(values.initialFdvWei),
    graduationFdvEth: eth(values.terminalV3FdvWei),
    curveGraduationFdvEth: eth(values.terminalCurveFdvWei),
  };
});

let state = createCurveState(SUPPLY);
const path = [];
for (const gross of [1n, 4n, 5n, 10n, 15n, 25n].map(value => value * WEI_PER_ETH / 1_000n)) {
  if (state.graduated) break;
  const trade = buy(state, gross);
  state = trade.nextState;
  path.push({
    grossInputEth: eth(trade.grossUsed),
    feeEth: eth(trade.fee),
    tokensOut: tokens(trade.tokenOut),
    netReserveEth: eth(state.realNativeReserve),
    curveFdvEth: eth(curveFdvWei(state)),
    graduated: state.graduated,
  });
}

process.stdout.write(`${JSON.stringify({
  proposal: "30% sold / 10% permanent V3 / 60% GM escrow",
  candidates,
  path,
  endpoint: {
    graduated: state.graduated,
    netNativeEth: eth(state.realNativeReserve),
    tokensSold: tokens(state.curveAllocation - state.realTokenReserve),
    tokensForV3: tokens(state.realTokenReserve),
    accruedTradingFeesEth: eth(state.accruedTradingFees),
  },
}, null, 2)}\n`);
