# Stock Pulse Lab

Realtime stock monitoring website with a built-in 7-day forecast model.

## Features

- Near realtime quote refresh every 60 seconds
- Watchlist switching (AAPL, MSFT, NVDA, GOOGL, AMZN, TSLA)
- Historical chart + forecast overlay with confidence band
- Lightweight trend + volatility model (client-side)
- Free-tier deployment ready (Vercel)

## Tech Stack

- React + Vite
- Recharts for visualization
- Alpha Vantage as stock data provider
- Vercel serverless functions for secure API proxy

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env.local` file:

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
4. Add environment variable:

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
- Free Alpha Vantage plans have rate limits. If you hit limits, wait for reset or reduce refresh frequency.
