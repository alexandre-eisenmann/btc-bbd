import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';

// ============================================================================
// STRUCTURAL BITCOIN PRICE MODEL
// ============================================================================

const createPriceModel = ({ P0, t0, H, g, sigma, theta }) => {
  const k = (H * Math.log(1 + g)) / Math.log((t0 + H) / t0);
  const A = P0 / Math.pow(t0, k);
  const getTrend = (t) => A * Math.pow(t, k);
  const getInstantaneousGrowthRate = (t) => k / t;
  const getStochasticPrice = (t, Y_t) => getTrend(t) * Math.exp(Y_t);
  const stationaryStd = sigma / Math.sqrt(2 * theta);
  
  return {
    k, A, sigma, theta, stationaryStd, P0, t0, H, g,
    getTrend, getInstantaneousGrowthRate, getStochasticPrice,
  };
};

const BTC_GENESIS = new Date(2009, 0, 3);

const getYearsSinceGenesis = (date = new Date()) => {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return (date - BTC_GENESIS) / msPerYear;
};

const BTCBorrowSimulator = () => {
  // Price Model Parameters
  const [btcPriceUSD, setBtcPriceUSD] = useState(90000);
  const [horizonYears, setHorizonYears] = useState(15);
  const [forwardCAGR, setForwardCAGR] = useState(30);
  const [annualVolatility, setAnnualVolatility] = useState(56);
  const [meanReversionSpeed, setMeanReversionSpeed] = useState(0.5);
  const t0Years = getYearsSinceGenesis();
  
  // Loan Parameters
  const [initialLVR, setInitialLVR] = useState(20);
  const [monthlySpend, setMonthlySpend] = useState(1000);
  const [annualInterest, setAnnualInterest] = useState(9.5);
  const [originationFee, setOriginationFee] = useState(2.0);
  const [randomSeed, setRandomSeed] = useState(0);
  const [initialBTC, setInitialBTC] = useState(1);
  
  const MONTHS = horizonYears * 12;
  
  const priceModel = useMemo(() => {
    return createPriceModel({
      P0: btcPriceUSD, t0: t0Years, H: horizonYears,
      g: forwardCAGR / 100, sigma: annualVolatility / 100, theta: meanReversionSpeed,
    });
  }, [btcPriceUSD, t0Years, horizonYears, forwardCAGR, annualVolatility, meanReversionSpeed]);
  
  const INITIAL_BTC_VALUE = initialBTC * btcPriceUSD;
  const INITIAL_DRAW = INITIAL_BTC_VALUE * (initialLVR / 100);
  const INITIAL_FEE = INITIAL_DRAW * (originationFee / 100);
  const INITIAL_LOAN = INITIAL_DRAW + INITIAL_FEE;
  const MONTHLY_INTEREST = (annualInterest / 100) / 12;
  const CASH_BUFFER = monthlySpend;
  const TARGET_FINAL_PRICE = priceModel.getTrend(t0Years + horizonYears);
  
  const seededRandom = (seed) => {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  
  const normalRandom = (seed, mean = 0, stdDev = 1) => {
    const u1 = seededRandom(seed);
    const u2 = seededRandom(seed + 1);
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  };
  
  const monthlyData = useMemo(() => {
    const data = [];
    let loanBalance = INITIAL_LOAN;
    let cashBalance = INITIAL_DRAW;
    let cumulativeSpend = 0;
    let totalDrawn = INITIAL_DRAW;
    let totalFees = INITIAL_FEE;
    
    const dt = 1 / 12;
    const sqrtDt = Math.sqrt(dt);
    const sigma = annualVolatility / 100;
    const theta = meanReversionSpeed;
    let Y_t = 0;
    let btcPrice = btcPriceUSD;
    let previousBtcPrice = btcPriceUSD;
    
    for (let month = 1; month <= MONTHS; month++) {
      cashBalance -= monthlySpend;
      cumulativeSpend += monthlySpend;
      
      let monthlyDraw = 0;
      let monthlyFee = 0;
      if (cashBalance < CASH_BUFFER) {
        monthlyDraw = monthlySpend * 12;
        monthlyFee = monthlyDraw * (originationFee / 100);
        loanBalance += monthlyDraw + monthlyFee;
        cashBalance += monthlyDraw;
        totalDrawn += monthlyDraw;
        totalFees += monthlyFee;
      }
      
      const interestCharge = loanBalance * MONTHLY_INTEREST;
      loanBalance += interestCharge;
      
      const t = t0Years + (month / 12);
      const tPrev = t0Years + ((month - 1) / 12);
      const trendPrice = priceModel.getTrend(t);
      const prevTrendPrice = month === 1 ? btcPriceUSD : priceModel.getTrend(tPrev);
      const trendMonthlyGrowth = (trendPrice / prevTrendPrice - 1) * 100;
      
      previousBtcPrice = btcPrice;
      
      if (annualVolatility > 0) {
        const Z = normalRandom(randomSeed + month * 2, 0, 1);
        Y_t = Y_t * (1 - theta * dt) + sigma * sqrtDt * Z;
        btcPrice = priceModel.getStochasticPrice(t, Y_t);
      } else {
        btcPrice = trendPrice;
        Y_t = 0;
      }
      
      const btcValue = btcPrice * initialBTC;
      const lvr = (loanBalance / btcValue) * 100;
      const impliedAnnualGrowth = (Math.pow(btcPrice / btcPriceUSD, 12 / month) - 1) * 100;
      const actualMonthlyGrowth = (btcPrice / previousBtcPrice - 1) * 100;
      const instantaneousGrowthRate = priceModel.getInstantaneousGrowthRate(t) * 100;
      const deviationFromTrend = (Math.exp(Y_t) - 1) * 100;
      
      data.push({
        month, t, btcValue, btcPrice, trendPrice, loanBalance, cashBalance, lvr,
        monthlyDraw, monthlyFee, monthlyGrowth: actualMonthlyGrowth, trendGrowth: trendMonthlyGrowth,
        impliedAnnualGrowth, instantaneousGrowthRate, totalDrawn, totalFees, interestCharge,
        Y_t, deviationFromTrend, year: Math.floor((month - 1) / 12) + 1
      });
    }
    return data;
  }, [initialBTC, btcPriceUSD, t0Years, horizonYears, initialLVR, monthlySpend, annualInterest, originationFee, forwardCAGR, annualVolatility, meanReversionSpeed, randomSeed, priceModel]);
  
  const [showTable, setShowTable] = useState(false);
  
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(value);
  };
  
  const formatPercent = (value) => value.toFixed(2) + '%';
  const formatNumber = (value, decimals = 4) => value.toFixed(decimals);
  
  const yearlySummaries = useMemo(() => {
    return Array.from({ length: horizonYears }, (_, i) => {
      const year = i + 1;
      const monthIndex = year * 12 - 1;
      const prevMonthIndex = (year - 1) * 12 - 1;
      const currentData = monthlyData[monthIndex];
      const prevBtcPrice = year === 1 ? btcPriceUSD : monthlyData[prevMonthIndex].btcPrice;
      const yearReturn = ((currentData.btcPrice / prevBtcPrice) - 1) * 100;
      const trendYearStart = year === 1 ? btcPriceUSD : priceModel.getTrend(t0Years + (year - 1));
      const trendYearEnd = priceModel.getTrend(t0Years + year);
      const trendReturn = ((trendYearEnd / trendYearStart) - 1) * 100;
      return { ...currentData, yearReturn, trendReturn };
    });
  }, [monthlyData, horizonYears, btcPriceUSD, priceModel, t0Years]);

  const riskMetrics = useMemo(() => {
    const peakLVR = Math.max(...monthlyData.map(d => d.lvr));
    const monthsAbove70 = monthlyData.filter(d => d.lvr >= 70).length;
    const monthsAbove80 = monthlyData.filter(d => d.lvr >= 80).length;
    const yearsWithMarginCall = yearlySummaries.filter(y => y.lvr >= 70).length;
    const yearsWithLiquidationRisk = yearlySummaries.filter(y => y.lvr >= 80).length;
    return { peakLVR, monthsAbove70, monthsAbove80, yearsWithMarginCall, yearsWithLiquidationRisk };
  }, [monthlyData, yearlySummaries]);
  
  const actualAnnualReturn = useMemo(() => {
    const finalPrice = monthlyData[MONTHS - 1]?.btcPrice || btcPriceUSD;
    return (Math.pow(finalPrice / btcPriceUSD, 1 / horizonYears) - 1) * 100;
  }, [monthlyData, btcPriceUSD, horizonYears, MONTHS]);

  const randomizeScenario = () => setRandomSeed(Math.floor(Math.random() * 10000));
  
  const resultsRef = React.useRef(null);
  const parametersRef = React.useRef(null);
  
  const runSimulation = () => {
    randomizeScenario();
    // Scroll to results after a brief delay to let the state update
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };
  
  const scrollToParameters = () => {
    parametersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Tooltip styles
  const tooltipStyle = {
    backgroundColor: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace"
  };

  return (
    <div className="w-full min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-6xl mx-auto px-6 py-12">
        
        {/* Header */}
        <header className="mb-20">
          <h1 className="text-4xl font-semibold tracking-tight mb-6 text-center" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Buy-Borrow-Die
          </h1>
          
          <div className="max-w-3xl space-y-5" style={{ color: 'var(--text-secondary)' }}>
            <p className="text-lg leading-relaxed" style={{ fontWeight: 300 }}>
              The <em style={{ color: 'var(--text-primary)', fontStyle: 'normal' }}>buy-borrow-die</em> strategy 
              is a wealth preservation technique: instead of selling appreciated assets and triggering capital gains taxes, 
              you borrow against them to fund your lifestyle. The loan proceeds aren't taxable income. 
              When you die, your heirs receive a stepped-up cost basis, potentially eliminating the deferred gains entirely.
            </p>
            
            {/* Primary CTA - visible immediately */}
            <div className="py-6 flex flex-col items-center">
              <button
                onClick={runSimulation}
                className="group px-6 py-3 text-sm font-medium rounded-lg transition-all flex items-center gap-3"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--bg-primary)',
                }}
              >
                <span>Run Simulation</span>
                <svg 
                  className="w-4 h-4 transition-transform group-hover:translate-x-1" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              <button
                onClick={scrollToParameters}
                className="text-xs mt-3 transition-all hover:opacity-80"
                style={{ color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                Change parameters
              </button>
            </div>
            
            <p className="leading-relaxed" style={{ fontWeight: 300 }}>
              This simulator models the strategy applied to Bitcoin. You hold BTC, borrow against it at a given 
              loan-to-value ratio, and spend the proceeds over time. As Bitcoin's price evolves, so does your 
              LVR — the critical metric that determines whether you face margin calls or liquidation.
            </p>
            
            <p className="leading-relaxed" style={{ fontWeight: 300 }}>
              The price model uses a <em style={{ color: 'var(--text-primary)', fontStyle: 'normal' }}>power-law trend</em> with 
              <em style={{ color: 'var(--text-primary)', fontStyle: 'normal' }}> mean-reverting stochastic volatility</em>. 
              This captures Bitcoin's historical pattern: long-term growth following a decaying power-law, 
              with substantial but bounded deviations that always revert toward the trend. The model is calibrated 
              to your forward CAGR expectations, not fitted to past data.
            </p>
          </div>
        </header>

        {/* Parameters Section */}
        <section ref={parametersRef} className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-8" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Parameters
          </h2>
          
          <h3 className="text-xs font-medium uppercase tracking-widest mb-6" style={{ color: 'var(--text-tertiary)' }}>
            Price Model
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <InputField
              label="BTC Price"
              value={btcPriceUSD}
              onChange={setBtcPriceUSD}
              prefix="$"
              min={1000} max={1000000} step={1000}
            />
            <div className="flex flex-col">
              <label className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Time (t₀)</label>
              <div className="px-3 py-2.5 font-mono text-sm rounded" style={{ 
                background: 'var(--bg-secondary)', 
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)'
              }}>
                {t0Years.toFixed(2)}y
              </div>
            </div>
            <InputField
              label="Horizon"
              value={horizonYears}
              onChange={setHorizonYears}
              suffix="years"
              min={1} max={30} step={1}
            />
            <InputField
              label="Forward CAGR"
              value={forwardCAGR}
              onChange={setForwardCAGR}
              suffix="%"
              min={-20} max={100} step={5}
            />
            <InputField
              label="Volatility (σ)"
              value={annualVolatility}
              onChange={setAnnualVolatility}
              suffix="%"
              min={0} max={200} step={5}
            />
            <InputField
              label="Mean Rev. (θ)"
              value={meanReversionSpeed}
              onChange={setMeanReversionSpeed}
              min={0.1} max={5} step={0.1}
            />
          </div>

          {/* Derived Parameters */}
          <div className="my-8 p-5 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
              <DerivedValue label="Exponent (k)" value={formatNumber(priceModel.k, 4)} />
              <DerivedValue label="Scale (A)" value={formatNumber(priceModel.A, 2)} />
              <DerivedValue label={`Target Yr ${horizonYears}`} value={formatCurrency(TARGET_FINAL_PRICE)} highlight />
              <DerivedValue label="μ(t₀) Growth" value={formatPercent(priceModel.k / t0Years * 100)} />
              <DerivedValue label="σ_Y Stationary" value={formatPercent(priceModel.stationaryStd * 100)} />
              <DerivedValue label="Typical Draw" value={`~${formatPercent((1 - Math.exp(-2 * priceModel.stationaryStd)) * 100)}`} />
            </div>
          </div>

          <h3 className="text-xs font-medium uppercase tracking-widest mb-6" style={{ color: 'var(--text-tertiary)' }}>
            Loan Parameters
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <InputField label="BTC Holdings" value={initialBTC} onChange={setInitialBTC} suffix="₿" min={0.1} max={100} step={0.1} />
            <InputField label="Initial LVR" value={initialLVR} onChange={setInitialLVR} suffix="%" min={1} max={40} step={1} />
            <InputField label="Monthly Spend" value={monthlySpend} onChange={setMonthlySpend} prefix="$" min={500} max={50000} step={500} />
            <InputField label="Interest Rate" value={annualInterest} onChange={setAnnualInterest} suffix="%" min={0} max={25} step={0.5} />
            <InputField label="Orig. Fee" value={originationFee} onChange={setOriginationFee} suffix="%" min={0} max={5} step={0.1} />
          </div>
          
          {/* Action */}
          <div className="mt-10 flex flex-col items-center gap-2">
          <button
            onClick={randomizeScenario}
            disabled={annualVolatility === 0}
            className="px-5 py-2.5 text-sm font-medium rounded transition-all"
            style={{
              background: annualVolatility === 0 ? 'var(--bg-tertiary)' : 'var(--accent)',
              color: annualVolatility === 0 ? 'var(--text-tertiary)' : 'var(--bg-primary)',
              cursor: annualVolatility === 0 ? 'not-allowed' : 'pointer',
              opacity: annualVolatility === 0 ? 0.5 : 1
            }}
          >
            Run Simulation
          </button>
          <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
            {annualVolatility === 0 ? 'Set σ > 0 for stochastic mode' : `Seed: ${randomSeed}`}
          </span>
          </div>
        </section>

        {/* Narrative Summary */}
        <section ref={resultsRef} className="mb-12 scroll-mt-8">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)', fontWeight: 300 }}>
              You start with <span style={{ color: 'var(--text-primary)' }}>{initialBTC} BTC</span> worth{' '}
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatCurrency(INITIAL_BTC_VALUE)}</span> at today's price.{' '}
              You borrow <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatCurrency(INITIAL_DRAW)}</span> against it 
              ({initialLVR}% LVR), paying a {originationFee}% origination fee.{' '}
              You spend <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatCurrency(monthlySpend)}/month</span>,{' '}
              drawing additional loans annually as needed at {annualInterest}% interest.
            </p>
            
            <p className="text-lg leading-relaxed mt-4" style={{ color: 'var(--text-secondary)', fontWeight: 300 }}>
              Over <span style={{ color: 'var(--text-primary)' }}>{horizonYears} years</span>, 
              {annualVolatility > 0 ? (
                <> if Bitcoin follows this random path with {forwardCAGR}% expected CAGR and {annualVolatility}% volatility,</>
              ) : (
                <> if Bitcoin follows the {forwardCAGR}% CAGR trend exactly,</>
              )}{' '}
              your BTC grows to{' '}
              <span className="font-mono" style={{ color: 'var(--accent)' }}>{formatCurrency(monthlyData[MONTHS - 1]?.btcValue || INITIAL_BTC_VALUE)}</span>{' '}
              while your loan reaches{' '}
              <span className="font-mono" style={{ color: 'var(--danger)' }}>{formatCurrency(monthlyData[MONTHS - 1]?.loanBalance || INITIAL_LOAN)}</span>.{' '}
              {(() => {
                const finalLvr = monthlyData[MONTHS - 1]?.lvr || 0;
                const peakLvr = riskMetrics.peakLVR;
                if (riskMetrics.yearsWithLiquidationRisk > 0) {
                  return (
                    <span style={{ color: 'var(--danger)' }}>
                      Your LVR peaks at {peakLvr.toFixed(0)}% — you would face liquidation.
                    </span>
                  );
                } else if (riskMetrics.yearsWithMarginCall > 0) {
                  return (
                    <span style={{ color: 'var(--warning)' }}>
                      Your LVR peaks at {peakLvr.toFixed(0)}%, triggering margin calls, but ends at {finalLvr.toFixed(0)}%.
                    </span>
                  );
                } else {
                  return (
                    <span style={{ color: 'var(--success)' }}>
                      Your LVR stays safe, peaking at {peakLvr.toFixed(0)}% and ending at {finalLvr.toFixed(0)}%.
                    </span>
                  );
                }
              })()}
            </p>
            
            <p className="text-sm mt-4" style={{ color: 'var(--text-tertiary)' }}>
              Total spent: {formatCurrency(monthlySpend * MONTHS)} over {horizonYears} years — 
              funded by {formatCurrency(monthlyData[MONTHS - 1]?.totalDrawn || INITIAL_DRAW)} in loans 
              ({formatCurrency(monthlyData[MONTHS - 1]?.totalFees || INITIAL_FEE)} in fees).
            </p>
            
            <button
              onClick={scrollToParameters}
              className="mt-6 text-sm transition-all hover:opacity-80"
              style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              ↑ Adjust parameters and run again
            </button>
          </div>
        </section>

        {/* Summary Cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Results */}
          <div className="p-6 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--text-tertiary)' }}>
              Results
            </h3>
            <div className="space-y-3">
              <SummaryRow label="Target CAGR" value={`${forwardCAGR}%`} subvalue={formatCurrency(TARGET_FINAL_PRICE)} />
              <SummaryRow label="Realized CAGR" value={`${actualAnnualReturn.toFixed(2)}%`} />
              <SummaryRow label="Final Price" value={formatCurrency(monthlyData[MONTHS - 1]?.btcPrice || btcPriceUSD)} />
              <SummaryRow label="Final Portfolio" value={formatCurrency(monthlyData[MONTHS - 1]?.btcValue || INITIAL_BTC_VALUE)} />
              <SummaryRow label="Final Loan" value={formatCurrency(monthlyData[MONTHS - 1]?.loanBalance || INITIAL_LOAN)} negative />
              <SummaryRow label="Final LVR" value={formatPercent(monthlyData[MONTHS - 1]?.lvr || 0)} />
              <SummaryRow label="Total Drawn" value={formatCurrency(monthlyData[MONTHS - 1]?.totalDrawn || 0)} />
            </div>
          </div>

          {/* Risk */}
          <div className="p-6 rounded-lg" style={{ 
            background: 'var(--bg-secondary)', 
            border: `1px solid ${
              riskMetrics.yearsWithLiquidationRisk > 0 ? 'var(--danger)' :
              riskMetrics.yearsWithMarginCall > 0 ? 'var(--warning)' : 'var(--border-subtle)'
            }`,
            borderLeftWidth: '3px'
          }}>
            <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ 
              color: riskMetrics.yearsWithLiquidationRisk > 0 ? 'var(--danger)' :
                     riskMetrics.yearsWithMarginCall > 0 ? 'var(--warning)' : 'var(--text-tertiary)'
            }}>
              Risk Assessment
            </h3>
            <div className="space-y-3">
              <SummaryRow label="Peak LVR" value={formatPercent(riskMetrics.peakLVR)} />
              <SummaryRow label="Months > 70%" value={`${riskMetrics.monthsAbove70} / ${MONTHS}`} />
              <SummaryRow label="Months > 80%" value={`${riskMetrics.monthsAbove80} / ${MONTHS}`} />
              <SummaryRow label="Margin Call Years" value={`${riskMetrics.yearsWithMarginCall} / ${horizonYears}`} />
              <SummaryRow label="Liquidation Years" value={`${riskMetrics.yearsWithLiquidationRisk} / ${horizonYears}`} />
            </div>
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {riskMetrics.yearsWithLiquidationRisk > 0 ? (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>This scenario would trigger liquidation</p>
              ) : riskMetrics.yearsWithMarginCall > 0 ? (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>Margin calls expected — additional collateral needed</p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--success)' }}>Within safe LVR limits throughout</p>
              )}
            </div>
          </div>
        </section>

        {/* LVR Chart */}
        <section className="mb-12">
          <h3 className="text-xs font-medium uppercase tracking-widest mb-6" style={{ color: 'var(--text-tertiary)' }}>
            LVR Over Time
          </h3>
          <div className="p-5 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            {(() => {
              const chartMax = Math.max(100, Math.ceil(riskMetrics.peakLVR / 10) * 10 + 10);
              return (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <ReferenceArea y1={70} y2={80} fill="#c9a048" fillOpacity={0.08} />
                    <ReferenceArea y1={80} y2={chartMax} fill="#b85450" fillOpacity={0.08} />
                    <XAxis dataKey="month" stroke="#666" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 11 }} domain={[0, chartMax]} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(value) => formatPercent(value)} contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} />
                    <ReferenceLine y={70} stroke="#c9a048" strokeDasharray="4 4" strokeOpacity={0.5} />
                    <ReferenceLine y={80} stroke="#b85450" strokeDasharray="4 4" strokeOpacity={0.5} />
                    <Line type="monotone" dataKey="lvr" stroke="#6b8db8" strokeWidth={1.5} name="LVR" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
            <div className="flex gap-6 mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(201, 160, 72, 0.3)' }}></span>
                Warning 70–80%
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(184, 84, 80, 0.3)' }}></span>
                Liquidation 80%+
              </span>
            </div>
          </div>
        </section>

        {/* Portfolio Chart */}
        <section className="mb-12">
          <h3 className="text-xs font-medium uppercase tracking-widest mb-6" style={{ color: 'var(--text-tertiary)' }}>
            Portfolio vs Trend vs Loan
          </h3>
          <div className="p-5 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={monthlyData.map(d => ({ ...d, trendValue: d.trendPrice * initialBTC }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="month" stroke="#666" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis 
                  stroke="#666" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} width={60}
                  tickFormatter={(value) => value >= 1000000 ? `$${(value / 1000000).toFixed(1)}M` : `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(value) => formatCurrency(value)} labelFormatter={(l) => `Month ${l}`} contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} />
                <Legend wrapperStyle={{ paddingTop: 20, fontSize: 12 }} />
                <Line type="monotone" dataKey="trendValue" stroke="#666" strokeWidth={1} strokeDasharray="4 4" name="Trend" dot={false} />
                <Line type="monotone" dataKey="btcValue" stroke="var(--accent)" strokeWidth={1.5} name="Portfolio" dot={false} />
                <Line type="monotone" dataKey="loanBalance" stroke="var(--danger)" strokeWidth={1.5} name="Loan" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Yearly Table */}
        <section className="mb-12">
          <h3 className="text-xs font-medium uppercase tracking-widest mb-6" style={{ color: 'var(--text-tertiary)' }}>
            Yearly Snapshots
          </h3>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  <Th align="left">Year</Th>
                  <Th>t</Th>
                  <Th>Trend</Th>
                  <Th>Actual</Th>
                  <Th>Price</Th>
                  <Th>Portfolio</Th>
                  <Th>Loan</Th>
                  <Th>LVR</Th>
                  <Th align="left">Status</Th>
                </tr>
              </thead>
              <tbody>
                {yearlySummaries.map((row) => {
                  const status = row.lvr >= 80 ? 'liquidation' : row.lvr >= 70 ? 'margin' : row.lvr >= 50 ? 'caution' : 'safe';
                  return (
                    <tr key={row.month} style={{ 
                      background: status === 'liquidation' ? 'rgba(184, 84, 80, 0.06)' : 
                                  status === 'margin' ? 'rgba(201, 160, 72, 0.06)' : 'transparent',
                      borderBottom: '1px solid var(--border-subtle)'
                    }}>
                      <Td align="left" bold>{row.year}</Td>
                      <Td mono muted>{row.t.toFixed(1)}</Td>
                      <Td mono muted>{row.trendReturn.toFixed(1)}%</Td>
                      <Td mono positive={row.yearReturn >= 0}>{row.yearReturn >= 0 ? '+' : ''}{row.yearReturn.toFixed(1)}%</Td>
                      <Td mono>{formatCurrency(row.btcPrice)}</Td>
                      <Td mono>{formatCurrency(row.btcValue)}</Td>
                      <Td mono negative>{formatCurrency(row.loanBalance)}</Td>
                      <Td mono status={status}>{formatPercent(row.lvr)}</Td>
                      <Td align="left">
                        <StatusBadge status={status} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Monthly Table Toggle */}
        <section className="mb-12 text-center">
          <button
            onClick={() => setShowTable(!showTable)}
            className="px-5 py-2.5 text-sm rounded transition-all"
            style={{ 
              background: 'transparent', 
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-muted)'
            }}
          >
            {showTable ? 'Hide' : 'Show'} Monthly Data
          </button>
        </section>

        {showTable && (
          <section className="mb-12">
            <div className="rounded-lg overflow-hidden max-h-96 overflow-y-auto" style={{ border: '1px solid var(--border-subtle)' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: 'var(--bg-tertiary)' }}>
                  <tr>
                    <Th align="left">Mo</Th>
                    <Th>t</Th>
                    <Th>Price</Th>
                    <Th>Trend</Th>
                    <Th>Dev</Th>
                    <Th>Loan</Th>
                    <Th>LVR</Th>
                    <Th>Draw</Th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((row) => (
                    <tr key={row.month} style={{ 
                      background: row.monthlyDraw > 0 ? 'rgba(90, 154, 110, 0.06)' : 'transparent',
                      borderBottom: '1px solid var(--border-subtle)'
                    }}>
                      <Td align="left">{row.month}</Td>
                      <Td mono muted>{row.t.toFixed(2)}</Td>
                      <Td mono>{formatCurrency(row.btcPrice)}</Td>
                      <Td mono muted>{formatCurrency(row.trendPrice)}</Td>
                      <Td mono positive={row.deviationFromTrend >= 0}>{row.deviationFromTrend >= 0 ? '+' : ''}{row.deviationFromTrend.toFixed(1)}%</Td>
                      <Td mono negative>{formatCurrency(row.loanBalance)}</Td>
                      <Td mono>{formatPercent(row.lvr)}</Td>
                      <Td mono>{row.monthlyDraw > 0 ? formatCurrency(row.monthlyDraw) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Mathematical Model Documentation - Always Visible */}
        <section className="mb-12">
          <div className="p-8 rounded-lg space-y-10" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            
            <div>
              <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Mathematical Model</h2>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)', lineHeight: 1.8 }}>
                This simulator uses a structural power-law model for Bitcoin price with mean-reverting stochastic volatility. 
                The model is designed to capture Bitcoin's historical behavior: long-term growth following a power-law trend, 
                with substantial but bounded deviations that always revert to the trend.
              </p>
            </div>

            {/* ==================== SECTION 1: MODEL OVERVIEW ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                1. Model Overview
              </h3>
              
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                The Bitcoin price P(t) is modeled as the product of a deterministic trend T(t) and a stochastic multiplicative factor:
              </p>
              
              <div className="p-5 rounded font-mono text-center mb-4" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-lg mb-3" style={{ color: 'var(--text-primary)' }}>
                  P(t) = T(t) · e<sup>Y<sub>t</sub></sup>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Price = Trend × Stochastic Multiplier
                </div>
              </div>
              
              <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                Where Y<sub>t</sub> is a mean-reverting process centered at zero. When Y<sub>t</sub> = 0, 
                the price equals the trend exactly. When Y<sub>t</sub> {">"} 0, price is above trend; 
                when Y<sub>t</sub> {"<"} 0, price is below trend.
              </p>
            </div>

            {/* ==================== SECTION 2: TREND FUNCTION ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                2. The Deterministic Trend Function
              </h3>
              
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                The trend follows a power-law in time since Bitcoin's genesis (January 3, 2009):
              </p>
              
              <div className="p-5 rounded font-mono text-center mb-4" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-lg mb-3" style={{ color: 'var(--text-primary)' }}>
                  T(t) = A · t<sup>k</sup>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  A = scale constant, k = power-law exponent, t = years since genesis
                </div>
              </div>
              
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <strong style={{ color: 'var(--text-primary)' }}>Why power-law?</strong> Bitcoin's historical price 
                follows a power-law pattern remarkably well. This functional form captures the observation that 
                percentage growth rates decrease over time as the asset matures — early Bitcoin had 1000%+ annual 
                returns, while mature Bitcoin has lower but still substantial growth.
              </p>
              
              <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                The instantaneous expected growth rate under this model is:
              </p>
              
              <div className="p-4 rounded font-mono text-center my-4" style={{ background: 'var(--bg-tertiary)' }}>
                <div style={{ color: 'var(--text-primary)' }}>
                  μ(t) = d[ln T]/dt = k / t
                </div>
              </div>
              
              <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                This shows growth rate decays as 1/t — the "diminishing returns" characteristic of maturing assets.
              </p>
            </div>

            {/* ==================== SECTION 3: PARAMETER CALIBRATION ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                3. Parameter Calibration
              </h3>
              
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                The model has two structural parameters (A, k) that are <em>derived</em> from user inputs, not set directly. 
                This ensures the model is forward-looking and anchored to your expectations.
              </p>
              
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                {/* Deriving k */}
                <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Deriving the Exponent k</h4>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                    We choose k such that the trend implies exactly g% CAGR over the next H years:
                  </p>
                  <div className="font-mono text-sm mb-3 p-3 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                    T(t₀ + H) / T(t₀) = (1 + g)<sup>H</sup>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                    Solving for k:
                  </p>
                  <div className="font-mono text-sm p-3 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>
                    k = [H · ln(1 + g)] / ln((t₀ + H) / t₀)
                  </div>
                </div>
                
                {/* Deriving A */}
                <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Deriving the Scale A</h4>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                    We anchor the trend to pass through today's price P₀ at time t₀:
                  </p>
                  <div className="font-mono text-sm mb-3 p-3 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                    T(t₀) = P₀
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                    Solving for A:
                  </p>
                  <div className="font-mono text-sm p-3 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>
                    A = P₀ / t₀<sup>k</sup>
                  </div>
                </div>
              </div>
              
              {/* Current Values */}
              <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-muted)' }}>
                <h4 className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
                  Current Calibration
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Input: P₀</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatCurrency(btcPriceUSD)}</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Input: t₀</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{t0Years.toFixed(4)} years</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Input: H</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{horizonYears} years</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Input: g</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{forwardCAGR}%</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Derived: k</div>
                    <div className="font-mono" style={{ color: 'var(--accent)' }}>{priceModel.k.toFixed(6)}</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Derived: A</div>
                    <div className="font-mono" style={{ color: 'var(--accent)' }}>{priceModel.A.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>μ(t₀)</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{(priceModel.k / t0Years * 100).toFixed(2)}%/yr</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>T(t₀ + H)</div>
                    <div className="font-mono" style={{ color: 'var(--accent)' }}>{formatCurrency(TARGET_FINAL_PRICE)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ==================== SECTION 4: STOCHASTIC COMPONENT ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                4. The Stochastic Component: Ornstein-Uhlenbeck Process
              </h3>
              
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                The log-deviation Y<sub>t</sub> follows an Ornstein-Uhlenbeck (O-U) process, which is a 
                mean-reverting stochastic process:
              </p>
              
              <div className="p-5 rounded font-mono text-center mb-4" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-lg mb-3" style={{ color: 'var(--text-primary)' }}>
                  dY<sub>t</sub> = −θ · Y<sub>t</sub> · dt + σ · dW<sub>t</sub>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Change in deviation = Mean-reversion pull + Random shock
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Understanding the Terms</h4>
                  <ul className="text-sm space-y-3" style={{ color: 'var(--text-secondary)' }}>
                    <li className="flex gap-3">
                      <span className="font-mono shrink-0" style={{ color: 'var(--accent)' }}>−θ·Y·dt</span>
                      <span style={{ lineHeight: 1.6 }}>
                        The "drift" term. When Y {">"} 0 (price above trend), this is negative, pulling Y back toward 0. 
                        When Y {"<"} 0, this is positive, pushing Y up. The larger |Y|, the stronger the pull.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-mono shrink-0" style={{ color: 'var(--accent)' }}>σ·dW</span>
                      <span style={{ lineHeight: 1.6 }}>
                        The "diffusion" term. W<sub>t</sub> is a standard Brownian motion (Wiener process). 
                        This adds random shocks with standard deviation σ per √year.
                      </span>
                    </li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Why O-U instead of Brownian Motion?</h4>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    Pure Brownian motion (random walk) has no mean reversion — deviations can grow unboundedly. 
                    The O-U process ensures prices always revert to trend, matching Bitcoin's observed behavior 
                    of cycling around a power-law corridor rather than drifting away permanently.
                  </p>
                </div>
              </div>
              
              <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                <h4 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Discrete-Time Implementation</h4>
                <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                  For simulation with time step Δt, we use the Euler-Maruyama discretization:
                </p>
                <div className="font-mono text-sm p-4 rounded mb-3" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                  Y<sub>t+Δt</sub> = Y<sub>t</sub> · (1 − θ · Δt) + σ · √Δt · Z
                </div>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                  Where Z ~ N(0,1) is a standard normal random variable. In this simulator, Δt = 1/12 year (monthly steps).
                </p>
              </div>
            </div>

            {/* ==================== SECTION 5: KEY PROPERTIES ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                5. Key Statistical Properties
              </h3>
              
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                The O-U process has well-defined long-run statistical properties that bound how far prices can deviate from trend:
              </p>
              
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                  <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Stationary Mean</h4>
                  <div className="font-mono text-lg mb-2" style={{ color: 'var(--accent)' }}>E[Y<sub>∞</sub>] = 0</div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                    The long-run average deviation is zero — prices center on the trend.
                  </p>
                </div>
                
                <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                  <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Stationary Variance</h4>
                  <div className="font-mono text-lg mb-2" style={{ color: 'var(--accent)' }}>Var[Y<sub>∞</sub>] = σ² / 2θ</div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                    Higher volatility σ increases variance; faster mean-reversion θ decreases it.
                  </p>
                </div>
                
                <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                  <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Half-Life</h4>
                  <div className="font-mono text-lg mb-2" style={{ color: 'var(--accent)' }}>t<sub>½</sub> = ln(2) / θ</div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                    Time for a deviation to decay by 50% (in expectation).
                  </p>
                </div>
              </div>
              
              <div className="p-5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-muted)' }}>
                <h4 className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
                  Current Parameter Values
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>σ (volatility)</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{(annualVolatility / 100).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>θ (mean reversion)</div>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{meanReversionSpeed.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>σ<sub>Y</sub> = σ/√(2θ)</div>
                    <div className="font-mono" style={{ color: 'var(--accent)' }}>{priceModel.stationaryStd.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>t<sub>½</sub> = ln(2)/θ</div>
                    <div className="font-mono" style={{ color: 'var(--accent)' }}>{(Math.log(2) / meanReversionSpeed).toFixed(2)} years</div>
                  </div>
                </div>
                
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 className="text-xs font-medium mb-3" style={{ color: 'var(--text-tertiary)' }}>Implied Price Deviations</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>±1σ range</div>
                      <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {((Math.exp(-priceModel.stationaryStd) - 1) * 100).toFixed(0)}% to +{((Math.exp(priceModel.stationaryStd) - 1) * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>±2σ range</div>
                      <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {((Math.exp(-2 * priceModel.stationaryStd) - 1) * 100).toFixed(0)}% to +{((Math.exp(2 * priceModel.stationaryStd) - 1) * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Typical max drawdown</div>
                      <div className="font-mono" style={{ color: 'var(--danger)' }}>
                        ~{((1 - Math.exp(-2 * priceModel.stationaryStd)) * 100).toFixed(0)}% from trend
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ==================== SECTION 6: COMPLETE MODEL SUMMARY ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                6. Complete Model Summary
              </h3>
              
              <div className="p-6 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-muted)' }}>
                <div className="space-y-4 font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <div className="pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Price Process</div>
                    <div style={{ color: 'var(--text-primary)' }}>P(t) = A · t<sup>k</sup> · e<sup>Y<sub>t</sub></sup></div>
                  </div>
                  
                  <div className="pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Deviation Dynamics</div>
                    <div style={{ color: 'var(--text-primary)' }}>dY<sub>t</sub> = −θ · Y<sub>t</sub> · dt + σ · dW<sub>t</sub></div>
                  </div>
                  
                  <div className="pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Parameter Calibration</div>
                    <div className="space-y-1">
                      <div>k = [H · ln(1 + g)] / ln((t₀ + H) / t₀) = <span style={{ color: 'var(--accent)' }}>{priceModel.k.toFixed(6)}</span></div>
                      <div>A = P₀ / t₀<sup>k</sup> = <span style={{ color: 'var(--accent)' }}>{priceModel.A.toFixed(4)}</span></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Input Parameters</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <div>P₀ = {formatCurrency(btcPriceUSD)}</div>
                      <div>t₀ = {t0Years.toFixed(4)} yr</div>
                      <div>H = {horizonYears} yr</div>
                      <div>g = {forwardCAGR}%</div>
                      <div>σ = {(annualVolatility / 100).toFixed(2)}</div>
                      <div>θ = {meanReversionSpeed.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ==================== SECTION 7: ASSUMPTIONS & LIMITATIONS ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                7. Assumptions & Limitations
              </h3>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Key Assumptions</h4>
                  <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--accent)' }}>1.</span>
                      <span>Bitcoin's price follows a power-law trend in the long run</span>
                    </li>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--accent)' }}>2.</span>
                      <span>Deviations from trend are mean-reverting (not random walk)</span>
                    </li>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--accent)' }}>3.</span>
                      <span>Volatility and mean-reversion parameters are constant over time</span>
                    </li>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--accent)' }}>4.</span>
                      <span>The forward CAGR you specify will be realized on the trend</span>
                    </li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Limitations</h4>
                  <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--danger)' }}>•</span>
                      <span>Past power-law behavior may not continue</span>
                    </li>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--danger)' }}>•</span>
                      <span>Volatility may change (especially decrease) over time</span>
                    </li>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--danger)' }}>•</span>
                      <span>Black swan events can exceed model bounds</span>
                    </li>
                    <li className="flex gap-2">
                      <span style={{ color: 'var(--danger)' }}>•</span>
                      <span>This is a model, not a prediction — use for scenario analysis</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ==================== SECTION 8: REFERENCES ==================== */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-widest mb-5" style={{ color: 'var(--accent)' }}>
                8. References & Further Reading
              </h3>
              
              <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
                <li>• Ornstein-Uhlenbeck process: Standard mean-reverting stochastic process used in physics and finance</li>
                <li>• Power-law models of Bitcoin: See research by PlanB (Stock-to-Flow), Harold Christopher Burger, and others</li>
                <li>• For O-U process mathematics: Gardiner, C. "Stochastic Methods" or Øksendal, B. "Stochastic Differential Equations"</li>
              </ul>
            </div>

          </div>
        </section>

        {/* Footer */}
        <footer className="pt-8 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <p className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
            P(t) = {priceModel.A.toFixed(2)} · t<sup>{priceModel.k.toFixed(4)}</sup> · exp(Y<sub>t</sub>)
          </p>
        </footer>
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENTS
// ============================================================================

const InputField = ({ label, value, onChange, prefix, suffix, ...props }) => (
  <div className="flex flex-col">
    <label className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-tertiary)' }}>{prefix}</span>
      )}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onFocus={(e) => e.target.select()}
        className="w-full px-3 py-2.5 text-sm rounded font-mono transition-all"
        style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          paddingLeft: prefix ? '1.75rem' : '0.75rem',
          paddingRight: suffix ? '2.5rem' : '0.75rem'
        }}
        {...props}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-tertiary)' }}>{suffix}</span>
      )}
    </div>
  </div>
);

const DerivedValue = ({ label, value, highlight }) => (
  <div>
    <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
    <div className="font-mono text-sm" style={{ color: highlight ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
  </div>
);

const SummaryRow = ({ label, value, subvalue, negative }) => (
  <div className="flex justify-between items-baseline">
    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
    <span className="font-mono text-sm" style={{ color: negative ? 'var(--danger)' : 'var(--text-primary)' }}>
      {value}
      {subvalue && <span className="ml-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>→ {subvalue}</span>}
    </span>
  </div>
);

const Th = ({ children, align = 'right' }) => (
  <th className={`px-3 py-3 text-xs font-medium uppercase tracking-wider text-${align}`} style={{ color: 'var(--text-tertiary)' }}>
    {children}
  </th>
);

const Td = ({ children, align = 'right', mono, muted, bold, positive, negative, status }) => {
  let color = 'var(--text-primary)';
  if (muted) color = 'var(--text-tertiary)';
  if (positive === true) color = 'var(--success)';
  if (positive === false) color = 'var(--danger)';
  if (negative) color = 'var(--danger)';
  if (status === 'liquidation') color = 'var(--danger)';
  if (status === 'margin') color = 'var(--warning)';
  if (status === 'caution') color = 'var(--warning)';
  if (status === 'safe') color = 'var(--success)';
  
  return (
    <td 
      className={`px-3 py-2.5 text-${align} ${mono ? 'font-mono' : ''} ${bold ? 'font-medium' : ''}`}
      style={{ color }}
    >
      {children}
    </td>
  );
};

const StatusBadge = ({ status }) => {
  const styles = {
    liquidation: { bg: 'rgba(184, 84, 80, 0.15)', color: 'var(--danger)', text: 'LIQUIDATION' },
    margin: { bg: 'rgba(201, 160, 72, 0.15)', color: 'var(--warning)', text: 'Margin Call' },
    caution: { bg: 'rgba(201, 160, 72, 0.1)', color: 'var(--warning)', text: 'Caution' },
    safe: { bg: 'rgba(90, 154, 110, 0.1)', color: 'var(--success)', text: 'Safe' }
  };
  const s = styles[status];
  return (
    <span className="px-2 py-1 text-xs rounded" style={{ background: s.bg, color: s.color }}>
      {s.text}
    </span>
  );
};

export default BTCBorrowSimulator;
