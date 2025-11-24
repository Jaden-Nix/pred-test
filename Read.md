# Predora - Prediction Markets Platform

## Overview
Predora is a Gen-Z prediction market platform built for the hackathon. Users can create and trade on prediction markets about future events, with AI-powered features for market creation, resolution, and analysis.



## Recent Changes & Fixes (November 17, 2025)

### 1. Market Odds Stability
**Problem:** Small bets were causing dramatic odds changes (e.g., $10 bet shifting 60/40 to 80/20)  
**Solution:**
- Implemented **minimum $1,000 USD liquidity requirement** for market creation
- Added comprehensive UI guidance explaining liquidity → odds stability relationship
- Quick Play markets use $50,000 virtual liquidity for stable demo experience
- Creators' liquidity is fully respected (no artificial inflation)

**Why this matters:** Higher liquidity pools = more stable, predictable odds that don't swing wildly with each bet

### 2. TVL Chart Display
**Problem:** Total Volume Locked (TVL) chart wasn't rendering on market detail pages  
**Solution:**
- Added explicit 250px height to chart canvas container
- Set `maintainAspectRatio: false` in Chart.js configuration
- Added error handling and null checks for canvas element

### 3. Manual Market Resolution
**Problem:** Demo/mock markets weren't appearing in admin resolution panel  
**Solution:**
- Removed filter that excluded mock markets
- Admins can now resolve all markets including demos for testing

## Project Architecture

### Frontend (index.html)
- Single-page application using vanilla JavaScript
- Firebase Firestore for data storage
- Chart.js for analytics visualization
- Tailwind CSS for styling (CDN)
- Dark/Light theme support

### Backend (index.js - Express Server)
- **Port:** 5000 (bound to 0.0.0.0 for Replit compatibility)
- **Endpoints:**
  - `/` - Serves the frontend
  - `/api/gemini` - Proxies AI requests to Google Gemini API
  - `/api/run-jobs` - Triggers Oracle jobs (requires CRON_SECRET)

### Oracle Jobs (Automated via Backend)
1. **Auto-Resolve Markets** - AI-powered resolution using Google Search
2. **Create Daily Markets** - Generates new markets based on trending topics
3. **Auto-Generate Quick Plays** - Creates short-term prediction events
4. **Auto-Resolve Quick Polls** - AI verification and resolution

## Environment Variables

Required secrets (configured in Replit Secrets):
- `GEMINI_API_KEY` - Google Gemini AI API key for AI features
- `CRON_SECRET` - Secret key to protect Oracle job endpoint
- `GOOGLE_APPLICATION_CREDENTIALS` - Firebase Admin SDK credentials (JSON string)

## Key Features

### Market Types
1. **Standard Markets** - Long-term predictions with customizable parameters
2. **Quick Play** - Fast 24-48 hour markets for quick results
3. **Binary Markets** - Simple YES/NO predictions
4. **Multi-Option Markets** - 3-6 outcome predictions

### AMM (Automated Market Maker)
- Constant product formula (x * y = k) for binary markets
- Pool-based distribution for multi-option markets
- Liquidity determines odds stability (min $1,000 required)

### AI Features
- **AI Assist** - Get AI explanations for odds and market analysis
- **AI Judge** - Automated market resolution with source verification
- **AI Oracle** - Background jobs for market creation and resolution

## User Preferences

### Development Workflow
- Client-side validation is intentional (demo/hackathon app)
- Production deployment would require:
  - Firestore security rules for data validation
  - Backend validation for market creation
  - Proper authentication (currently using mock accounts)

### Design Philosophy
- Mobile-first responsive design
- Clean, modern UI with gradient accents
- Accessible dark/light themes
- Fast, lightweight architecture

## Firebase Structure

All data stored in: `artifacts/predora-hackathon/public/data/`

Collections:
- `profile` - User profiles and balances
- `leaderboard` - Public leaderboard data
- `standard_markets` - Main prediction markets
- `quick_play_markets` - Fast 24-48hr markets
- `pledges` - User bets/stakes
- `stake_logs` - Historical stake data for charts
- `market_comments` - Market discussions

## Testing & Demo

### Demo Accounts
- Judge (judge-123)
- Alice (alice-456)
- Bob (bob-789)

### Mock Balances
- BUSD: $5,000
- BNB: 10 tokens ($5,000 @ $500/token)
- CAKE: 1,500 tokens ($5,250 @ $3.50/token)

### Admin Access
Password: `predora-admin`

## Known Limitations (Demo/Hackathon Context)

1. **Client-side validation only** - Appropriate for demo, but production needs backend enforcement
2. **No real authentication** - Using mock accounts for demo purposes
3. **Public Firestore paths** - All data accessible (demo-only, would need security rules in production)
4. **Tailwind CDN** - For quick development, should use build process in production

## Deployment Notes

### Replit Configuration
- Server runs on port 5000 with 0.0.0.0 binding
- Workflow: `predora-server` runs `npm start`
- Output type: webview (shows frontend to users)

### Migration from Vercel
- Vercel routing (`vercel.json`) no longer needed
- All routes handled by Express server
- Environment variables migrated to Replit Secrets

## Future Enhancements (Post-Hackathon)

1. Add Firestore security rules for data validation
2. Implement proper authentication (OAuth, etc.)
3. Add backend validation for critical operations
4. Optimize Tailwind CSS (build process instead of CDN)
5. Add comprehensive error logging
6. Implement rate limiting for AI endpoints
7. Add unit and integration tests

---

Last updated: November 17, 2025
Project Type: Hackathon Demo
Status: Production-ready for demo purposes
