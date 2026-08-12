import assert from "node:assert/strict";
import test from "node:test";

import {
  RECOMMENDED_CURVE,
  WEI_PER_ETH,
  accounting,
  buy,
  createCurveState,
  deriveCurveParameters,
  sell,
  splitEligibleTradingFee,
} from "../curve-model.mjs";

const TOKEN = 10n ** 18n;
const SUPPLY = 1_000_000_000n * TOKEN;

test("the proposed allocations reconcile to the fixed supply", () => {
  const p = deriveCurveParameters(SUPPLY);
  assert.equal(p.curveAllocation + p.gmEscrow, SUPPLY);
  assert.equal(p.soldAtGraduation + p.v3LiquidityTokens, p.curveAllocation);
  assert.equal(p.soldAtGraduation, 300_000_000n * TOKEN);
  assert.equal(p.v3LiquidityTokens, 100_000_000n * TOKEN);
  assert.equal(p.gmEscrow, 600_000_000n * TOKEN);
});

test("the 30/10 proposal derives exact virtual reserves", () => {
  const p = deriveCurveParameters(SUPPLY);
  assert.equal(p.virtualTokenStart, 450_000_000n * TOKEN);
  assert.equal(p.virtualTokenFinal, 150_000_000n * TOKEN);
  assert.equal(p.virtualNativeStart, 25_000_000_000_000_000n);
  assert.equal(p.terminalVirtualNative, 75_000_000_000_000_000n);
});

test("the terminal curve price equals the V3 initialization price", () => {
  const p = deriveCurveParameters(SUPPLY);
  assert.equal(p.terminalCurveFdvWei, p.terminalV3FdvWei);
  assert.equal(p.initialFdvWei, WEI_PER_ETH / 18n);
  assert.equal(p.terminalV3FdvWei, WEI_PER_ETH / 2n);
  assert.equal(p.terminalV3FdvWei / p.initialFdvWei, 9n);
});

test("a one-way fill graduates with 30 percent sold and 10 percent retained", () => {
  const state = createCurveState(SUPPLY);
  const trade = buy(state, 60_000_000_000_000_000n);
  assert.equal(trade.graduated, true);
  assert.equal(trade.nextState.realNativeReserve, 50_000_000_000_000_000n);
  assert.equal(trade.nextState.realTokenReserve, 100_000_000n * TOKEN);
  assert.equal(trade.nextState.curveAllocation - trade.nextState.realTokenReserve, 300_000_000n * TOKEN);
  assert(trade.refund > 0n);
  assert.equal(trade.grossUsed, trade.netNative + trade.fee);
  assert.equal(trade.grossOffered, trade.grossUsed + trade.refund);
});

test("many buys reach the same deterministic graduation endpoint", () => {
  let state = createCurveState(SUPPLY);
  for (const gross of [1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n].map(v => v * 10n ** 15n)) {
    if (state.graduated) break;
    state = buy(state, gross).nextState;
  }
  assert.equal(state.graduated, true);
  assert.equal(state.realNativeReserve, state.graduationNetNativeWei);
  assert.equal(state.realTokenReserve, state.v3LiquidityTokens);
});

test("the exact endpoint holds at both inherited supply bounds", () => {
  for (const supply of [1_000_000n * TOKEN, 1_000_000_000_000_000n * TOKEN]) {
    const trade = buy(createCurveState(supply), 60_000_000_000_000_000n);
    assert.equal(trade.nextState.realTokenReserve, supply / 10n);
    assert.equal(trade.nextState.curveAllocation - trade.nextState.realTokenReserve, supply * 3n / 10n);
  }
});

test("buy then sell cannot create native profit", () => {
  const start = createCurveState(SUPPLY);
  const bought = buy(start, 10_000_000_000_000_000n);
  const sold = sell(bought.nextState, bought.tokenOut);
  assert(sold.netNativeOut < bought.grossUsed);
  assert.equal(sold.nextState.realNativeReserve, 0n);
  assert.equal(sold.nextState.realTokenReserve, start.realTokenReserve);
  assert(sold.nextState.accruedTradingFees > bought.fee);
});

test("a holder cannot sell more tokens than the curve distributed", () => {
  const state = createCurveState(SUPPLY);
  assert.throws(() => sell(state, 1n), /more tokens than the curve distributed/);
});

test("all trading stops once graduation is reached", () => {
  const graduated = buy(createCurveState(SUPPLY), 60_000_000_000_000_000n).nextState;
  assert.throws(() => buy(graduated, 1_000_000_000_000_000n), /graduated/);
  assert.throws(() => sell(graduated, 1n), /graduated/);
});

test("trading fees remain separate from graduation collateral", () => {
  const start = createCurveState(SUPPLY);
  const { nextState } = buy(start, 10_000_000_000_000_000n);
  const balances = accounting(nextState);
  assert.equal(balances.totalNativeCustody, balances.nativeForGraduation + balances.tradingFees);
  assert.equal(balances.nativeForGraduation, nextState.realNativeReserve);
  assert.equal(balances.tokenInventory + balances.tokensDistributed, nextState.curveAllocation);
});

test("the eligible 70/15/15 fee split always reconciles", () => {
  for (const fee of [0n, 1n, 99n, 10_000n, 123_456_789n]) {
    const split = splitEligibleTradingFee(fee);
    assert.equal(split.creator + split.treasury + split.doomRewards, fee);
  }
});

test("alternative sale/liquidity splits can be compared without a price jump", () => {
  for (const [soldAtGraduationBps, v3LiquidityTokenBps] of [[2_500n, 1_500n], [3_500n, 500n]]) {
    const p = deriveCurveParameters(SUPPLY, {
      ...RECOMMENDED_CURVE,
      soldAtGraduationBps,
      v3LiquidityTokenBps,
    });
    const delta = p.terminalCurveFdvWei > p.terminalV3FdvWei
      ? p.terminalCurveFdvWei - p.terminalV3FdvWei
      : p.terminalV3FdvWei - p.terminalCurveFdvWei;
    // Non-integer reserve ratios are rounded down to token/native base units.
    // Even the aggressive 35/5 comparison must stay within ten wei of FDV.
    assert(delta <= 10n);
  }
});

test("invalid economic proposals fail before a curve can be created", () => {
  assert.throws(() => deriveCurveParameters(SUPPLY, {
    ...RECOMMENDED_CURVE,
    soldAtGraduationBps: 2_000n,
    v3LiquidityTokenBps: 2_000n,
  }), /exceed/);
  assert.throws(() => deriveCurveParameters(SUPPLY, {
    ...RECOMMENDED_CURVE,
    curveAllocationBps: 4_001n,
  }), /equal 10000/);
});
