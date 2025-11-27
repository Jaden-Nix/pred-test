# Predora - AI-Native Prediction Markets Platform

## Overview

Predora is a prediction markets platform that enables users to create markets, place bets, and have outcomes automatically resolved using AI-powered oracles. The platform emphasizes ease of use with a "tap-to-predict" interface and leverages AI for content moderation, market resolution, and user assistance. Built as an MVP/hackathon project, it prioritizes rapid development and simplicity over complex infrastructure.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### November 27, 2025 - Critical Payout Calculation, Balance Update & Pool Architecture Fixes
- **Fixed payout calculation (Backend)**: The backend was incorrectly dividing pool equally among winners
  - Changed from `poolTotal / winners.length` to proportional stake-based payouts
  - New formula: `stake + (stake / totalWinningStake) * losingPool`
  - Winners now receive their stake back plus proportional share of losing pool
  - This correctly rewards larger stakes with proportionally larger winnings
- **Fixed payout calculation (Frontend)**: The admin resolution used incorrect odds-based formula
  - Removed `pledge.amountUsd / (winningOddsForPayout / 100)` calculation
  - Replaced with same proportional formula as backend for consistency
  - Added logging for payout pool calculations
- **Fixed balance not updating in realtime**: Balance display wasn't refreshing after transactions
  - Added `populateAssetSelector()` call to profile snapshot listener
  - Now all balance displays (header, asset selector, wallet cards) update when Firestore changes arrive
  - Users will see balance changes immediately after payouts or stakes
- **Fixed architectural mismatch between AMM liquidity and stake totals**:
  - **Root Cause**: The old AMM formula used mutable liquidity pools (`yesPool`/`noPool`) that shift with trades via constant-product formula, not actual cumulative stake totals. This caused pools to show ~$205 when $700+ was actually staked.
  - **New Architecture**: Added `totalYesStake`/`totalNoStake` fields to track actual stake totals. The `yesPool`/`noPool` values now mirror these totals for consistent display.
  - **Unified Payout Preview**: Changed payout preview during staking to use the same proportional formula as resolution: `stake + (stake/totalWinningStake) * losingPool`. Previously showed AMM "shares" (~$89) but resolution paid proportionally (~$208).
  - **Percentage Stability**: Odds percentages now calculated from actual stake totals, preventing small stakes from dramatically flipping percentages.
  - **Repair Function Enhancement**: Backend repair now recalculates stake totals from existing pledges instead of resetting to defaults or deleting markets.
  - **UI Label Update**: Changed "Pool Liquidity (AMM)" to "Total Staked" for clarity.

### November 26, 2025 - Multi-Option Market Fixes & Mobile UX Improvements
- **Fixed multi-option display bug**: Options were showing as "undefined" because odds weren't being calculated from optionAmounts
  - Implemented proper odds calculation by summing all optionAmounts values and computing percentages
  - Added equal distribution fallback (100 / options.length) when no pool data exists
  - Added clamping to ensure odds stay within [0, 100] range
- **Fixed multi-option staking**: Adapted staking logic to work with backend data format
  - Backend stores options as string arrays `["Team A", "Team B"]` with `optionAmounts: {"Team A": 5000}`
  - Updated AMM logic to normalize optionAmounts (ensure all options have entries) before computing odds
  - Added guards against division by zero and invalid payout calculations
- **Fixed Gaming category**: Added "Gaming" to both oracle AI prompts (standard + quick play)
  - Oracle now properly categorizes esports, game releases, gaming tournaments as "Gaming" instead of "Entertainment" or "Other"
  - Gaming markets now appear correctly when clicking the Gaming filter
- **Mobile navigation update**: Replaced Copy Trading with Quick Play in mobile bottom nav
  - Mobile users can now access Quick Play (pledge pool & quick polls) from bottom navigation
  - Copy Trading remains accessible via desktop navigation AND Profile screen sidebar
  - Added "Copy Trading" quick access panel in Profile for easy mobile access
  - Prioritizes mobile-first swipe-style betting experience while keeping all features accessible
- **Fixed Quick Play card sizing**: Added max-width constraint to prevent cards from stretching too large on wide screens
  - Cards now maintain consistent 672px max width, centered on screen
  - Improves visual consistency across all screen sizes
- **Fixed comment UX issue**: Comments now stay open after posting
  - Previously, posting a comment would reload the entire social feed and close all comment sections
  - Implemented state preservation to keep comment sections open when feed updates
  - Users can now see their comment appear immediately without losing their position in the feed
- **Fixed edit/delete comment buttons**: Edit and delete options now properly appear on user's own comments
  - Previous ownership check only matched exact userId, failing for demo accounts
  - Updated to check both userId AND displayName for proper comment ownership detection
  - Users can now edit and delete their own comments regardless of account type
- **Implemented Twitter/Reddit style threaded comments**: Comments now display in hierarchical conversation threads
  - Deep nesting support up to 5 levels with visual indentation (6ml left margin, vertical line separator)
  - Replies appear nested under parent comments with lighter background color
  - Recursive rendering with cycle prevention using visited Set
  - Replies sorted chronologically within each thread
  - XSS security: Removed all inline onclick handlers, implemented data-attribute pattern with commentDataStore
  - User content HTML-escaped before rendering to prevent script injection
  - Event delegation handles all comment interactions (edit, delete, reply, menu toggle)

## System Architecture

### Frontend Architecture

**Decision**: Vanilla HTML/CSS/JavaScript with Tailwind CSS via CDN  
**Rationale**: No-framework approach enables rapid prototyping and minimal complexity for hackathon/MVP timeline. Eliminates build processes and tooling overhead.  
**Alternatives Considered**: React/Vue frameworks were avoided to reduce setup complexity and bundle size  
**Trade-offs**:
- **Pros**: Zero build time, instant deployment, minimal dependencies, easy debugging
- **Cons**: No component reusability, manual DOM manipulation, limited scalability for complex UIs

**Key Pages**:
- `index.html` - Landing page with modern gradient hero, mesh backgrounds, glassmorphism cards, 3D device mockup, and enhanced animations
- `login.html` - Authentication entry point
- `app.html` - Main application interface with live activity signals, gamification, and interactive features
- `pitch-deck/index.html` - Presentation deck

**Styling System**: Tailwind CSS with custom configuration  
**Decision**: CDN-based Tailwind with inline config  
**Features**: 
- Custom glassmorphism effects and gradient animations
- Pre-render theme script to prevent FOUC (Flash of Unstyled Content)
- Light/dark mode with localStorage persistence
- 300+ lines of enhanced CSS animations for micro-interactions
- Activity signals, trending badges, reaction animations, achievement popups, and more

**Interactive Features** (Added November 2025):
- **Live Activity System**: Real-time toast notifications showing user actions (predictions, comments, wins, achievements)
- **Trending Indicators**: Hot badges and momentum signals on popular markets
- **Gamification**: Achievement popups with confetti, streak flames, badge unlocks
- **Typing Indicators**: Animated "user is typing..." in comments section
- **Live Reactions**: Animated reaction counters with spark effects
- **Mini Leaderboards**: Top predictors displayed in social feed
- **Price Flash Effects**: Visual feedback on market price changes
- **Card Animations**: Smooth entrance and hover effects on all market cards
- **Activity Badges**: Notification pings on navigation icons
- **Visual Feedback**: Micro-interactions throughout the app for every user action

**State Management**:
- **Demo Users**: localStorage for persistent demo sessions
- **Email Users**: sessionStorage for temporary sessions, fallback to localStorage
- **Authentication Check**: Pre-render script prevents login screen flash

### Backend Architecture

**Technology Stack**: Node.js + Express with ES modules  
**Decision**: Express.js middleware-based RESTful API  
**Rationale**: Well-documented, simple to deploy, and sufficient for current scale requirements  
**Pros**: Extensive ecosystem, straightforward routing, easy deployment  
**Cons**: Less opinionated than frameworks like NestJS, requires manual structure

**File Structure**:
- `index.js` - Main server with all API routes and business logic
- `ai-guardrails.js` - Multi-layer content moderation system
- `swarm-verify-oracle.js` - Multi-agent AI verification for market resolution
- `cron-job.js` - Scheduled task runner for automated market resolution

**API Authentication**: Firebase Admin SDK  
**Decision**: Firebase for user authentication and session management  
**Rationale**: Industry-standard auth, built-in security, minimal backend code required

### AI Integration Architecture

**Primary AI Provider**: Google Gemini 2.5 Flash (free tier)  
**Decision**: Single AI provider for all operations (content moderation, market resolution, chat assistant)  
**Rationale**: Gemini's free tier offers generous quotas suitable for MVP; unified API reduces complexity  
**Previous Architecture**: Originally used OpenAI, migrated to Gemini for cost optimization  
**Use Cases**:
1. Content moderation and safety filtering
2. AI assistant chat interface
3. Market outcome resolution

**Swarm Verification System** (`swarm-verify-oracle.js`):  
**Decision**: Multi-agent consensus system for high-stakes market resolutions  
**Architecture**:
- Parallel agent execution with timeout handling (12 seconds)
- Geometric median aggregation for confidence scoring
- Multi-dimensional scoring: factual accuracy (45%), consistency (25%), timestamp (20%), sentiment (10%)
- Second-pass review for low-confidence decisions (<85% threshold)

**Configuration**:
- High confidence: >90% (auto-resolve)
- Mid confidence: 85-90% (second review)
- Low confidence: <50% (manual intervention)

### Content Safety Architecture

**Multi-Layer Moderation Pipeline** (`ai-guardrails.js`):

**Layer 1 - Pre-filtering**: Keyword blocklist for immediate rejection  
**Categories**: Financial manipulation, hate speech, violence, illegal activity, spam  
**Decision**: Fast regex-based blocking before expensive AI calls  

**Layer 2 - Rate Limiting**:
- Markets: 5 per minute
- Comments: 30 per minute  
- Requests: 300 per hour
**Rationale**: Prevent abuse and API quota exhaustion

**Layer 3 - AI Moderation**: Gemini-based content analysis  
**Thresholds**:
- Auto-approve: >95% safety confidence
- Manual review: 70-95% confidence
- Block: <50% confidence
**Decision**: Three-tier system balances automation with human oversight for edge cases

**Event Logging**: Structured logging system tracks all safety decisions for audit and improvement

### Email Integration

**Provider**: SendGrid via Replit Connectors  
**Decision**: Use Replit's connector system for credential management  
**Implementation**: Dynamic credential fetching (no caching) to ensure fresh tokens  
**Fallback**: Environment variable API key if connector unavailable  
**Use Case**: User authentication via email verification

### Task Scheduling

**Solution**: Node-cron + Replit Scheduled Deployment  
**Decision**: Separate cron job file (`cron-job.js`) that calls server endpoint  
**Architecture**: 
- Cron job runs on schedule
- Makes HTTP POST to `/api/run-jobs` with secret key authentication
- Server processes market resolutions and poll auto-closures
**Rationale**: Decouples scheduling from server runtime; allows server restarts without losing schedules

## External Dependencies

### Third-Party APIs

1. **Google Gemini API** (`@google/generative-ai`)
   - Purpose: All AI operations (moderation, resolution, chat)
   - Model: gemini-2.5-flash-preview-09-2025
   - Tier: Free tier with generous quotas

2. **Firebase** (`firebase`, `firebase-admin`)
   - Purpose: User authentication and session management
   - Services: Firebase Auth, Admin SDK for token verification

3. **SendGrid** (`@sendgrid/mail`)
   - Purpose: Email verification and notifications
   - Integration: Replit Connectors + fallback to API key

### NPM Packages

- `express` - Web server framework
- `cors` - Cross-origin resource sharing
- `node-fetch` - HTTP client for API calls
- `node-cron` - Task scheduling
- `openai` - Legacy dependency (now unused, can be removed)

### Frontend Dependencies (CDN)

- Tailwind CSS - Utility-first styling framework
- Lucide Icons - Icon library
- Google Fonts - Outfit, Space Grotesk, Inter, JetBrains Mono

### Environment Variables Required

- `GEMINI_API_KEY` - Google AI API key
- `CRON_SECRET` - Secret key for scheduled job authentication
- `ADMIN_SECRET` - Admin API authentication
- `SENDGRID_API_KEY` - Email service API key (fallback)
- `REPLIT_CONNECTORS_HOSTNAME` - Replit connector endpoint
- `REPL_IDENTITY` - Replit identity token
- Firebase credentials (handled by Firebase Admin SDK)

### Hosting Platform

**Platform**: Replit  
**Rationale**: Zero-config deployment, built-in connectors, scheduled tasks, environment management  
**Deployment**: Automatic on git push, no build step required