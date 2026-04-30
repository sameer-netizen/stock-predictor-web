# Stock Pulse Lab

Realtime stock monitoring website with a built-in 7-day forecast model.

## Features

- Near realtime quote refresh every 60 seconds
- Multi-timeframe monitoring: 5m, Daily, and Hourly modes
- Live feed heartbeat indicator (live/lagging/stale)
- Optional stale-feed alerts (visual pulse + audible beep after 30s stale)
- Alert log panel with stale/recovered timestamps
- Market switcher for Indian and global exchanges (US, NSE, BSE, LSE, TSE)
- Market-aware watchlists (for example RELIANCE.NS, TCS.BO, 7203.T)
- Custom ticker search (load any valid symbol)
- Historical chart + forecast overlay with confidence band
- Technical indicators (SMA/EMA, RSI, Bollinger, support/resistance)
- Stock-specific sentiment scoring from ticker-focused headlines only
- Secondary sentiment source fallback via Yahoo RSS when search feed coverage is low
- ML-style model evaluation metrics (RMSE, MAPE)
- Ensemble forecasting engine (trend regression + mean reversion + AR)
- Model leaderboard with per-model RMSE/MAPE and dynamic ensemble weights
- Walk-forward backtest (hit-rate, return, max drawdown by model + ensemble)
- Dedicated Strategy Backtest tab with equity-curve chart
- Adjustable train/test split slider (60% to 90%) for model validation
- Risk tools (7% stop-loss rule, 10 AM ET volatility hint, diversification reminders)
- Lightweight trend + volatility model (client-side)
- Free-tier deployment ready (Vercel)

## Tech Stack

- React + Vite
- Recharts for visualization
- Yahoo Finance (default, keyless) with optional Alpha Vantage fallback
- Vercel serverless functions for secure API proxy

## Setup

1. Install dependencies:

```bash
npm install
```

2. Optional: create a `.env.local` file for Alpha fallback:

```bash
VITE_ALPHA_VANTAGE_API_KEY=your_free_alpha_vantage_key
```

3. Run locally (frontend only mode, direct API fallback):

```bash
npm run dev
```

4. Build production bundle:

```bash
npm run build
```

## Vercel Deployment (Free)

1. Push this folder to a new GitHub repository.
2. Go to Vercel and click New Project.
3. Import the repository.
4. Optional environment variable (only needed for Alpha fallback):

```bash
ALPHA_VANTAGE_API_KEY=your_free_alpha_vantage_key
```

5. Deploy.

Vercel will host:

- Static frontend from `dist`
- API proxy endpoints under `/api/quote`, `/api/history`, and `/api/insights`

## API Endpoints

- `GET /api/quote?symbol=AAPL`
- `GET /api/history?symbol=AAPL`
- `GET /api/insights?symbol=RELIANCE.NS`

## Important Notes

- This app is for educational use only and is not financial advice.
- Yahoo Finance can also apply upstream rate limits occasionally. If this happens, retry after a short interval.
