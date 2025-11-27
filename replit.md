# Predora - AI-Native Prediction Markets Platform

## Overview

Predora is a prediction markets platform that enables users to create markets, place bets, and have outcomes automatically resolved using AI-powered oracles. The platform emphasizes gamification, social features, and ease of use with features like Quick Play (swipe-to-predict), AI mentorship, and real-time market analytics.

The application is built as a full-stack JavaScript application using Firebase for backend services and Gemini AI for intelligent features including market resolution, content moderation, and user assistance.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- Vanilla JavaScript (ES6+) with modular organization
- No framework dependencies - direct DOM manipulation
- Tailwind CSS for styling with custom design system
- Chart.js for portfolio analytics visualization

**Key Design Patterns:**
- Module-based organization (separate JS files for markets, portfolio, AI features, etc.)
- Event-driven architecture with Firebase real-time listeners
- Progressive enhancement with loading states
- Mobile-first responsive design with swipe gestures

**Client-Side State Management:**
- In-memory state for markets (`allStandardMarkets`, `allQuickMarkets`)
- Session-based user authentication state (`window.currentUser`)
- LocalStorage for theme preferences and demo user credentials
- Real-time sync with Firebase Firestore listeners

### Backend Architecture

**Server Framework:**
- Express.js REST API (ESM modules)
- CORS enabled for cross-origin requests
- Static file serving for frontend assets

**Core Services:**

1. **Market Resolution System:**
   - Automated cron job (`cron-job.js`) for scheduled market resolution
   - Swarm verification oracle (`swarm-verify-oracle.js`) with multi-agent consensus
   - Geometric median calculation for outcome aggregation
   - Second-pass review system for low-confidence resolutions

2. **Authentication & Security:**
   - Firebase Authentication (email/password, demo users)
   - OTP-based email verification via SendGrid
   - In-memory OTP fallback store for quota management
   - Admin secret for protected endpoints

3. **Content Moderation:**
   - AI guardrails system (`ai-guardrails.js`)
   - Pre-filtering for spam, length, repetition
   - Keyword blocklist for prohibited content
   - Rate limiting (per-minute and per-hour)
   - Gemini AI-based content moderation
   - Safety event logging

4. **Payout & Liquidity System:**
   - Proportional stake-based payout formula: `stake + (stake / totalWinningStake) * losingPool`
   - Unified pool tracking with `totalYesStake` and `totalNoStake` fields
   - Real-time balance updates via Firestore listeners
   - Multi-option market support with `optionAmounts` map

**Key Architectural Decisions:**

1. **AMM Pool Removal:** Originally used Automated Market Maker (constant-product formula) with mutable `yesPool`/`noPool` values. Replaced with simple stake aggregation (`totalYesStake`/`totalNoStake`) to prevent percentage instability and ensure payout consistency.

2. **Proportional Payouts:** Winners receive their original stake plus a proportional share of the losing pool based on their stake size, rather than equal distribution among winners.

3. **Real-time Balance Sync:** All balance displays update immediately via Firestore snapshot listeners calling `populateAssetSelector()`.

4. **AI-First Resolution:** Markets resolve automatically via Gemini AI oracle with swarm verification and confidence scoring, minimizing manual intervention.

### Data Storage

**Firebase Firestore Collections:**

1. **users:**
   - User profiles with display names, avatars, balances
   - Multi-asset support (USD, BTC, ETH via `assets` map)
   - Portfolio tracking and statistics

2. **markets:**
   - Standard markets with binary (YES/NO) or multi-option outcomes
   - Fields: `title`, `description`, `category`, `resolutionDate`, `totalYesStake`, `totalNoStake`, `optionAmounts`
   - Status tracking: `open`, `resolved`, `admin_resolved`
   - Resolution data: `winningOption`, `oracleConfidence`, `resolvedBy`

3. **pledges:**
   - Individual user stakes on markets
   - Fields: `marketId`, `userId`, `option`, `amountUsd`, `timestamp`
   - Used for payout calculations and portfolio analytics

4. **quickMarkets:**
   - Fast-resolving markets for Quick Play feature
   - Similar structure to standard markets but shorter timeframes

5. **socialPosts:**
   - User-generated content for social feed
   - Community discussions and market commentary

6. **otps:**
   - Email verification codes
   - Fallback to in-memory store when quota exceeded

**Data Consistency Patterns:**
- Firestore transactions for critical updates (pledges, balance changes)
- Real-time listeners for UI synchronization
- Server-side validation before writes
- Repair functions to recalculate derived fields from source data

### Authentication & Authorization

**Multi-Mode Authentication:**
1. Firebase Authentication for registered users
2. Demo mode with URL parameters (`?demoUser=X&demoName=Y`)
3. LocalStorage persistence for demo sessions

**Protected Endpoints:**
- Admin operations require `ADMIN_SECRET` header
- Cron jobs require `CRON_SECRET` in request body
- User operations validated via Firebase Auth tokens

### AI Integration Strategy

**Gemini AI (Primary):**
- Market resolution and verification
- Content moderation
- AI mentor chatbot
- Category classification
- Confidence scoring

**Multi-Agent Verification:**
- Parallel agent execution for resolution
- Geometric median consensus algorithm
- Second-pass review for disputed outcomes
- Configurable confidence thresholds

**Rationale:** Gemini chosen for cost-effectiveness (free tier), low latency, and strong reasoning capabilities for oracle tasks.

## External Dependencies

### Third-Party Services

1. **Firebase (Google Cloud)**
   - **Firestore:** Primary database for all application data
   - **Authentication:** User identity management
   - **Admin SDK:** Server-side Firebase operations
   - **Client SDK:** Real-time listeners and auth state

2. **Google Gemini AI**
   - **Model:** `gemini-2.5-flash-preview-09-2025`
   - **Usage:** Market resolution, content moderation, AI assistant
   - **API:** REST endpoint via `@google/generative-ai` npm package

3. **SendGrid**
   - **Purpose:** Transactional email for OTP verification
   - **Integration:** Dynamic credential fetching from environment
   - **Package:** `@sendgrid/mail`

### NPM Packages

**Core Dependencies:**
- `express` - Web server framework
- `cors` - Cross-origin resource sharing
- `firebase` - Client SDK
- `firebase-admin` - Server SDK
- `@google/generative-ai` - Gemini AI client
- `@sendgrid/mail` - Email service
- `node-fetch` - HTTP client for Node.js
- `node-cron` - Scheduled task execution

**Deprecated:**
- `openai` - Previously used, now replaced by Gemini AI

### External APIs

1. **Gemini API Endpoint:**
   - URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`
   - Authentication: API key in environment variables
   - Rate limits managed by Google Cloud quotas

### Environment Variables

**Required:**
- `GEMINI_API_KEY` - Gemini AI authentication
- `CRON_SECRET` - Scheduled job authentication
- `ADMIN_SECRET` - Admin endpoint protection

**Optional:**
- `PORT` - Server port (default: 5000)
- `REPLIT_DEVSERVER_URL` - For cron job callbacks

**Firebase Credentials:**
- Managed via Firebase Admin SDK initialization
- Service account credentials in environment or Replit Secrets

### Deployment Platform

**Replit:**
- Primary hosting environment
- Scheduled deployments for cron jobs
- Environment variable management via Secrets
- Auto-scaling web server

**Vercel (Alternative):**
- `vercel.json` configuration present
- Serverless function routing to `index.js`