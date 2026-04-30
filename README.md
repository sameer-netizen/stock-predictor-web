# Stock Pulse Lab

Realtime stock monitoring website with a built-in 7-day forecast model.

## Features

- Near realtime quote refresh every 60 seconds
- Multi-timeframe monitoring: 5m, Daily, and Hourly modes
- Live feed heartbeat indicator (live/lagging/stale)
- Watchlist switching (AAPL, MSFT, NVDA, GOOGL, AMZN, TSLA)
- Custom ticker search (load any valid symbol)
- Historical chart + forecast overlay with confidence band
- Technical indicators (SMA/EMA, RSI, Bollinger, support/resistance)
- Sentiment scoring from recent finance headlines
- ML-style model evaluation metrics (RMSE, MAPE)
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
- API proxy endpoints under `/api/quote` and `/api/history`

## API Endpoints

- `GET /api/quote?symbol=AAPL`
- `GET /api/history?symbol=AAPL`

## Important Notes

- This app is for educational use only and is not financial advice.
- Yahoo Finance can also apply upstream rate limits occasionally. If this happens, retry after a short interval.
