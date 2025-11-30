# Predora - AI-Native Prediction Markets Platform

## Overview

Predora is a prediction markets platform that enables users to create markets, place bets (called "stakes"), and have outcomes automatically resolved using AI-powered oracles. The platform combines traditional prediction market mechanics with modern AI features, gamification, and social elements to create an engaging forecasting experience.

**Core Value Proposition**: Users can predict outcomes on real-world events (sports, crypto, politics, tech, etc.) and earn rewards when their predictions are correct. The platform uses AI to automatically resolve markets fairly and provide intelligent insights.

**Key Features**:
- Standard prediction markets with YES/NO binary outcomes and multi-option markets
- Quick Play mode with swipe-to-stake Tinder-style interface
- AI-powered market resolution using multi-agent verification
- Social feed with user following, leaderboards, and copy trading
- AI Market Mentor chatbot for prediction guidance
- Portfolio analytics with win rate tracking
- Email-based authentication with OTP (One-Time Password)
- Virtual currency system ($USD) for staking

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack**:
- Vanilla JavaScript (ES6+) with modular design pattern
- No framework dependency - pure HTML/CSS/JS
- Tailwind CSS for styling
- Firebase SDK for client-side authentication and real-time database
- Chart.js for analytics visualization
- Lucide icons for UI elements

**Module Organization**:
The frontend is organized into feature-based JavaScript modules:
- `js/markets.js` - Market display, filtering, and betting logic
- `js/ai-features.js` - AI insights, predictions, and smart suggestions
- `js/ai-mentor.js` - Conversational AI chatbot powered by Gemini
- `js/portfolio-dashboard.js` - Analytics charts and performance tracking
- `js/swipe-gestures.js` - Touch/swipe interactions for Quick Play
- `js/onboarding.js` - Multi-step wizard for new user onboarding
- `js/nav-icons.js` - SVG icon definitions for navigation

**State Management**:
- Global state stored in window object (`window.currentUser`, `window.currentProfile`)
- Firebase real-time listeners for live data updates
- In-memory caching of markets and user profiles
- Local storage for theme preferences and demo mode state

**Key Design Patterns**:
- Event-driven architecture with Firebase listeners
- Modular JS files loaded dynamically
- Real-time UI updates via Firestore snapshots
- Responsive design with mobile-first approach
- Progressive enhancement for AI features

### Backend Architecture

**Technology Stack**:
- Node.js with Express.js web framework
- ES Modules (type: "module" in package.json)
- Firebase Admin SDK for server-side operations
- Google Gemini AI (free tier) for all AI features
- SendGrid for transactional emails (OTP delivery)
- Node-cron for scheduled tasks

**Core API Endpoints**:
- `/api/moderate-content` - AI content moderation using Gemini
- `/api/ai-chat` - Conversational AI mentor chatbot
- `/api/run-jobs` - Cron job endpoint for automated market resolution
- `/api/oracle-resolve` - Manual admin trigger for market resolution
- `/api/send-otp` - Email OTP generation and delivery
- `/api/verify-otp` - OTP validation for authentication

**AI Oracle System**:
The platform uses a sophisticated multi-agent verification system (`swarm-verify-oracle.js`) for market resolution:
- **Primary Agent**: Gemini Flash model analyzes market outcome with web search
- **Verification Agent**: Second Gemini instance validates the primary decision
- **Consensus Mechanism**: Geometric median scoring across multiple confidence signals
- **Second-Pass Review**: Optional low-temperature re-verification for edge cases
- **Multi-Model Scoring**: Blends factual accuracy, consistency, timestamp validity, and sentiment analysis

**Resolution Workflow**:
1. Cron job (`cron-job.js`) calls `/api/run-jobs` every hour
2. Backend queries markets past their resolution date
3. For each market, the swarm oracle analyzes available data
4. Confidence threshold determines auto-resolve vs manual review
5. Winners receive proportional payouts: `stake + (stake / totalWinningStake) * losingPool`
6. Balance updates propagate via Firestore real-time listeners

**Payout Calculation Architecture**:
- **Proportional Stake-Based**: Winners split the losing pool proportionally to their stake size
- **Formula**: Each winner receives their original stake back plus their proportional share of the losing pool
- **No AMM Price Curves**: The platform displays odds for UI purposes but uses actual stake totals for payouts
- **Consistency**: Both frontend preview and backend resolution use identical formulas

**Content Moderation System** (`ai-guardrails.js`):
- Pre-filtering for length, repetition, and character set validation
- Keyword blocklist for immediate rejection of prohibited content
- AI-powered moderation via Gemini for nuanced safety checks
- Rate limiting per user (minute/hour windows)
- Three-tier decision system: auto-approve, manual review, block
- Safety event logging for audit trails

### Data Storage

**Firebase Firestore Collections**:
- `users` - User profiles with balances, stats, and settings
- `markets` - Standard prediction markets with metadata, pools, and resolution data
- `quickMarkets` - Quick Play markets with rapid resolution
- `pledges` - Individual user stakes on markets
- `socialPosts` - User activity feed posts
- `comments` - Market discussion threads
- `follows` - User-to-user following relationships
- `copyTrades` - Copy trading configurations
- `transactions` - Financial transaction history
- `otps` - One-time password storage (with in-memory fallback)

**Data Model Design Decisions**:
- Denormalized data for read performance (user stats embedded in profiles)
- Real-time listeners for live updates across clients
- Compound queries require Firestore indexes (configured in Firebase Console)
- Transaction history for audit trail and dispute resolution
- In-memory OTP store as fallback when Firestore quota exceeded

**Market Data Structure**:
```javascript
{
  title: string,
  description: string,
  category: string,
  type: 'binary' | 'multiple',
  options: string[],  // For multi-option markets
  yesPool: number,    // Total YES stakes (mirrors totalYesStake)
  noPool: number,     // Total NO stakes (mirrors totalNoStake)
  totalYesStake: number,  // Actual cumulative YES stakes
  totalNoStake: number,   // Actual cumulative NO stakes
  optionAmounts: {},  // For multi-option: {"Option A": 5000, "Option B": 3000}
  resolved: boolean,
  outcome: string,
  resolutionDate: timestamp,
  oracleConfidence: number
}
```

### Authentication System

**Email-Based OTP Flow**:
1. User enters email address
2. Backend generates 6-digit OTP and stores with expiration (5 minutes)
3. SendGrid sends OTP via email
4. User enters OTP to verify
5. Firebase custom token created for session
6. Client receives token and authenticates with Firebase

**Demo Mode**:
- URL parameters `?demoUser=X&demoName=Y` create temporary accounts
- Stored in localStorage to prevent login screen flash
- Used for quick testing and public demonstrations

**Security Considerations**:
- OTP expires after 5 minutes
- Rate limiting on OTP generation (3 per email per hour)
- Firebase security rules enforce user-specific data access
- Admin operations require `ADMIN_SECRET` environment variable
- CRON jobs protected by `CRON_SECRET` key

## External Dependencies

### AI Services
- **Google Gemini AI** (`@google/generative-ai` npm package)
  - Model: `gemini-2.5-flash-preview-09-2025`
  - Purpose: Market resolution oracle, content moderation, AI mentor chatbot, market insights
  - Free tier with generous quota
  - Requires `GEMINI_API_KEY` environment variable

### Backend Services
- **Firebase** (Authentication + Firestore Database)
  - Client SDK: `firebase` npm package v12.5.0
  - Admin SDK: `firebase-admin` npm package v13.6.0
  - Real-time database with snapshot listeners
  - Requires Firebase project credentials in environment variables
  
- **SendGrid** Email Delivery
  - Package: `@sendgrid/mail` v8.1.6
  - Purpose: OTP delivery for email authentication
  - Requires `SENDGRID_API_KEY` environment variable
  - Sender email configured as `SENDGRID_FROM_EMAIL`

### Scheduled Tasks
- **Node-Cron** (`node-cron` v3.0.3)
  - Runs hourly oracle sweeps for market resolution
  - `cron-job.js` executable calls `/api/run-jobs` endpoint
  - Deployed as Replit Scheduled Deployment

### HTTP & Middleware
- **Express.js** v4.19.2 - Web framework
- **CORS** v2.8.5 - Cross-origin resource sharing
- **node-fetch** v3.3.2 - HTTP client for API calls

### Frontend CDN Libraries
- **Tailwind CSS** - Loaded via CDN for styling
- **Chart.js** v4.4.0 - Dynamically loaded for analytics charts
- **Lucide Icons** - SVG icon library loaded via CDN
- **Google Fonts** - Inter and Space Grotesk typefaces

### Environment Variables Required
```
GEMINI_API_KEY - Google AI API key
CRON_SECRET - Secret for cron job authentication
ADMIN_SECRET - Secret for admin operations
SENDGRID_API_KEY - SendGrid email service key
SENDGRID_FROM_EMAIL - Sender email address
Firebase credentials (managed by Firebase Admin SDK)
```

### Deployment Platform
- **Replit** - Primary hosting platform
  - Automatic HTTPS
  - Environment variable management
  - Scheduled deployments for cron jobs
  - `REPLIT_DEVSERVER_URL` environment variable for dynamic URLs