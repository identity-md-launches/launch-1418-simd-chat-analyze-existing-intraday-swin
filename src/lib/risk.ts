import type { Candle, Strategy } from '../types';
import { sizePosition } from './engine';
import { readStored, writeStored } from './storage';

export type StopMode = 'fixed' | 'atr' | 'trailing';
export type RiskProfile = {
  armed: boolean;
  stopMode: StopMode;
  fixedStopPct: number;
  atrMultiplier: number;
  trailingPct: number;
  riskPct: number;
  maxDrawdownPct: number;
  dailyLossPct: number;
};
export type RiskAccount = {
  equity: number;
  peakEquity: number;
  dayStartEquity: number;
  dayKey: string;
  updatedAt: number;
  drawdownTripped: boolean;
  dailyTripped: boolean;
};
export type Protection = {
  status: 'off' | 'armed' | 'tripped' | 'setup';
  canEnter: boolean;
  reason: string;
  drawdownPct: number;
  dailyLossPct: number;
  remainingLoss: number | null;
};

export const RISK_PROFILE_KEY = 'simd.risk.profile.v1';
export const RISK_ACCOUNT_KEY = 'simd.risk.account.v1';
export const DEFAULT_RISK_PROFILE: RiskProfile = {
  armed: false,
  stopMode: 'fixed',
  fixedStopPct: 2,
  atrMultiplier: 2,
  trailingPct: 2,
  riskPct: 1,
  maxDrawdownPct: 10,
  dailyLossPct: 3,
};
const utcDay = (now: number) => new Date(now * 1000).toISOString().slice(0, 10);

export function validateRiskProfile(profile: RiskProfile): string | null {
  if (typeof profile.armed !== 'boolean' || !['fixed', 'atr', 'trailing'].includes(profile.stopMode))
    return 'Choose a valid stop mode and protection state.';
  if (
    ![
      profile.fixedStopPct,
      profile.atrMultiplier,
      profile.trailingPct,
      profile.riskPct,
      profile.maxDrawdownPct,
      profile.dailyLossPct,
    ].every(Number.isFinite)
  )
    return 'Enter a number in every protection field.';
  if (
    profile.fixedStopPct < 0.1 ||
    profile.fixedStopPct > 50 ||
    profile.trailingPct < 0.1 ||
    profile.trailingPct > 50
  )
    return 'Set fixed and trailing stops between 0.1% and 50%.';
  if (profile.atrMultiplier < 0.5 || profile.atrMultiplier > 10)
    return 'Set the ATR multiplier between 0.5 and 10.';
  if (profile.riskPct < 0.1 || profile.riskPct > 10) return 'Set position risk between 0.1% and 10%.';
  if (
    profile.maxDrawdownPct < 0.5 ||
    profile.maxDrawdownPct > 50 ||
    profile.dailyLossPct < 0.1 ||
    profile.dailyLossPct > 20
  )
    return 'Set maximum drawdown between 0.5% and 50%, and daily loss between 0.1% and 20%.';
  if (profile.dailyLossPct > profile.maxDrawdownPct)
    return 'Set the daily loss limit at or below the maximum drawdown.';
  if (profile.riskPct > profile.dailyLossPct) return 'Set position risk at or below the daily loss limit.';
  return null;
}

export function isRiskProfile(value: unknown): value is RiskProfile {
  return !!value && typeof value === 'object' && validateRiskProfile(value as RiskProfile) === null;
}
export function isRiskAccount(value: unknown): value is RiskAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as RiskAccount;
  return (
    [account.equity, account.peakEquity, account.dayStartEquity, account.updatedAt].every(Number.isFinite) &&
    account.equity >= 0 &&
    account.equity <= 1e9 &&
    account.peakEquity > 0 &&
    account.peakEquity >= account.equity &&
    account.dayStartEquity > 0 &&
    account.updatedAt > 0 &&
    typeof account.dayKey === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(account.dayKey) &&
    typeof account.drawdownTripped === 'boolean' &&
    typeof account.dailyTripped === 'boolean'
  );
}
export function loadRiskProfile(strategy?: Strategy): RiskProfile {
  const fallback = {
    ...DEFAULT_RISK_PROFILE,
    ...(strategy
      ? { fixedStopPct: strategy.stop, riskPct: Math.min(strategy.risk, DEFAULT_RISK_PROFILE.dailyLossPct) }
      : {}),
  };
  return readStored(RISK_PROFILE_KEY, fallback, isRiskProfile);
}
export function loadRiskAccount(): RiskAccount | null {
  return readStored<RiskAccount | null>(
    RISK_ACCOUNT_KEY,
    null,
    (value): value is RiskAccount | null => value === null || isRiskAccount(value),
  );
}
export function saveRiskProfile(profile: RiskProfile): boolean {
  const error = validateRiskProfile(profile);
  if (error) throw new Error(error);
  return writeStored(RISK_PROFILE_KEY, profile);
}
export function saveRiskAccount(account: RiskAccount): boolean {
  if (!isRiskAccount(account)) throw new Error('Use a valid manually entered paper account balance.');
  return writeStored(RISK_ACCOUNT_KEY, account);
}

/** Protections use manually supplied paper equity, never exchange account balances. */
export function evaluateProtection(
  profile: RiskProfile,
  account: RiskAccount | null,
  now = Date.now() / 1000,
): Protection {
  const valid = account && isRiskAccount(account) ? account : null;
  const drawdownPct = valid ? Math.max(0, ((valid.peakEquity - valid.equity) / valid.peakEquity) * 100) : 0;
  const dailyLossPct = valid
    ? Math.max(0, ((valid.dayStartEquity - valid.equity) / valid.dayStartEquity) * 100)
    : 0;
  const metrics = {
    drawdownPct,
    dailyLossPct,
    remainingLoss: valid
      ? Math.max(
          0,
          Math.min(
            valid.equity - valid.peakEquity * (1 - profile.maxDrawdownPct / 100),
            valid.equity - valid.dayStartEquity * (1 - profile.dailyLossPct / 100),
          ),
        )
      : null,
  };
  if (validateRiskProfile(profile))
    return {
      ...metrics,
      status: 'setup',
      canEnter: false,
      reason: 'Protection settings are invalid. Save a valid risk profile.',
    };
  if (!profile.armed)
    return {
      ...metrics,
      status: 'off',
      canEnter: true,
      reason: 'Paper protections are off. Save and arm a profile to pause new paper entries at your limits.',
    };
  if (!valid)
    return {
      ...metrics,
      status: 'setup',
      canEnter: false,
      reason: 'Enter paper account equity to establish your protection baselines.',
    };
  if (valid.drawdownTripped || drawdownPct >= profile.maxDrawdownPct)
    return {
      ...metrics,
      status: 'tripped',
      canEnter: false,
      reason: 'Maximum drawdown reached. Paper entries are paused until you explicitly start a new baseline.',
    };
  if (valid.dayKey !== utcDay(now) || valid.updatedAt > now + 60)
    return {
      ...metrics,
      status: 'setup',
      canEnter: false,
      reason: 'Update paper equity for the current UTC day before adding a paper entry.',
    };
  if (valid.dailyTripped || dailyLossPct >= profile.dailyLossPct)
    return {
      ...metrics,
      status: 'tripped',
      canEnter: false,
      reason:
        'Daily loss limit reached. Paper entries stay paused for this UTC day unless you explicitly reset the baseline.',
    };
  return {
    ...metrics,
    status: 'armed',
    canEnter: true,
    reason: 'Paper entries are allowed within the manually reported equity limits.',
  };
}

export function recordEquity(
  previous: RiskAccount | null,
  equity: number,
  profile: RiskProfile,
  now = Date.now() / 1000,
): RiskAccount {
  if (!Number.isFinite(equity) || equity < 0 || equity > 1e9 || !Number.isFinite(now) || now <= 0)
    throw new Error('Enter paper equity between $0 and $1,000,000,000.');
  if (validateRiskProfile(profile)) throw new Error(validateRiskProfile(profile)!);
  if (!previous && equity <= 0) throw new Error('Start a paper account with equity above zero.');
  const dayKey = utcDay(now);
  const peakEquity = Math.max(equity, previous?.peakEquity ?? equity);
  const dayStartEquity = previous?.dayKey === dayKey ? previous.dayStartEquity : equity;
  // A depleted account keeps a positive baseline so the loss remains measurable.
  const dailyBaseline = dayStartEquity || previous?.dayStartEquity || peakEquity;
  return {
    equity,
    peakEquity,
    dayStartEquity: dailyBaseline,
    dayKey,
    updatedAt: now,
    drawdownTripped:
      !!previous?.drawdownTripped || ((peakEquity - equity) / peakEquity) * 100 >= profile.maxDrawdownPct,
    dailyTripped:
      (previous?.dayKey === dayKey && previous.dailyTripped) ||
      ((dailyBaseline - equity) / dailyBaseline) * 100 >= profile.dailyLossPct,
  };
}

export function averageTrueRange(candles: Candle[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 || candles.length < period + 1) return null;
  const start = candles.length - period;
  let total = 0;
  for (let i = start; i < candles.length; i++) {
    const bar = candles[i],
      previous = candles[i - 1];
    if (![bar.high, bar.low, previous.close].every(Number.isFinite) || bar.low <= 0 || bar.high < bar.low)
      return null;
    total += Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close),
    );
  }
  return total / period;
}

/** bestPrice is the best observed price since entry; previousStop prevents a trailing stop from loosening. */
export function stopPrice(
  profile: RiskProfile,
  entry: number,
  side: 'buy' | 'sell',
  candles: Candle[],
  bestPrice = entry,
  previousStop?: number,
): number {
  const error = validateRiskProfile(profile);
  if (error) throw new Error(error);
  if (
    ![entry, bestPrice].every((value) => Number.isFinite(value) && value > 0) ||
    !['buy', 'sell'].includes(side)
  )
    throw new Error('Enter positive entry and observed prices.');
  const direction = side === 'buy' ? -1 : 1;
  let stop: number;
  if (profile.stopMode === 'atr') {
    const atr = averageTrueRange(candles);
    if (atr === null || atr <= 0)
      throw new Error('ATR stops need at least 15 valid price bars and a positive trading range.');
    stop = entry + direction * atr * profile.atrMultiplier;
  } else if (profile.stopMode === 'trailing') {
    const extreme = side === 'buy' ? Math.max(entry, bestPrice) : Math.min(entry, bestPrice);
    stop = extreme * (1 + (direction * profile.trailingPct) / 100);
    if (previousStop !== undefined) {
      if (!Number.isFinite(previousStop) || previousStop <= 0)
        throw new Error('Use a positive previous stop.');
      stop = side === 'buy' ? Math.max(stop, previousStop) : Math.min(stop, previousStop);
    }
  } else stop = entry * (1 + (direction * profile.fixedStopPct) / 100);
  if (!Number.isFinite(stop) || stop <= 0)
    throw new Error(
      'This stop would be zero or negative. Reduce the ATR multiplier or check the entry price.',
    );
  return stop;
}

export function protectedPosition(
  profile: RiskProfile,
  account: RiskAccount | null,
  capital: number,
  entry: number,
  stop: number,
  target: number,
  side: 'buy' | 'sell' = 'buy',
  now = Date.now() / 1000,
) {
  const protection = evaluateProtection(profile, account, now);
  if (!protection.canEnter) throw new Error(protection.reason);
  if (!Number.isFinite(capital) || capital <= 0)
    throw new Error('Enter positive paper capital before sizing a position.');
  // An armed profile sizes from reported equity, so editing calculator capital cannot bypass a limit.
  const effectiveCapital = profile.armed && account ? Math.min(capital, account.equity) : capital;
  const riskPct =
    profile.armed && protection.remainingLoss !== null
      ? Math.min(profile.riskPct, (protection.remainingLoss / effectiveCapital) * 100)
      : profile.riskPct;
  const result = sizePosition(effectiveCapital, riskPct, entry, stop, target, side);
  return { ...result, protectionCapped: riskPct < profile.riskPct, effectiveCapital };
}
