# Predora - Prediction Market Platform

## Overview
Predora is a decentralized prediction market platform with AI-powered market resolution, social features, and a comprehensive admin panel. This project uses Firebase for data storage, OpenAI for swarm-based verification, and Google's Gemini AI for market resolution.

## Recent Changes (November 24, 2025)
- **Guest Mode**: App now opens in guest mode by default - users can browse markets and social feed without signing in
- **Restricted Guest Access**: Guests can only view home and social feed screens; all interactions (create post, react, comment, place stakes) prompt sign-in
- **Demo Accounts**: Judge/Alice/Bob demo accounts have full unrestricted access like real users
- **Social Feed API Integration**: Rewritten to use backend APIs (fixed XSS vulnerability, race conditions, security issues)
- **Removed Logos**: Cleaned up UI - no redundant logos in app header
- **Fixed Social Feed Bugs**: 10+ bugs fixed including race conditions, wrong avatars, missing error handling
- **Backend API Endpoints**: Added delete/edit endpoints for posts and comments
- **Integrated Email/OTP Authentication System**: Added passwordless login with 6-digit OTP codes
- **Social Feed System**: Implemented post creation, reactions, comments, and social interactions
- **Admin Panel**: Added administrative controls for market resolution and platform management
- **Jury System**: Implemented dispute resolution with 5-juror voting system and 30-minute dispute windows
- **AI Guardrails**: Added content moderation using OpenAI's moderation API
- **Login Page**: Created standalone login.html with modern UI

## Project Structure
```
/
├── index.js              # Express backend server with all API endpoints
├── app.html              # Main application (9374 lines)
├── login.html            # Authentication page
├── index.html            # Landing page
├── package.json          # Dependencies
└── replit.md            # This file
```

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth (Custom Tokens)
- **AI**: OpenAI (GPT-4o, GPT-4o-mini), Google Gemini
- **Email**: SendGrid (optional)
- **Frontend**: Tailwind CSS, Vanilla JavaScript

## Firebase Collections
All data is stored in: `artifacts/predora-hackathon/public/data/`

### Collections:
- `standard_markets` - Main prediction markets
- `quick_play_markets` - Fast 24-48hr markets
- `pledges` - User bets/stakes
- `leaderboard` / `public_leaderboard` - User rankings
- `user_profile` - User profiles and data
- `social_posts` - Social feed posts
- `jury_codes` - 8-character jury invitation codes
- `jury_votes` - Jury voting records
- `notifications` - User notifications
- `otp_codes` - Email verification OTP codes
- `market_comments` - Market discussions
- `stake_logs` - Historical stake data for charts

## Required Secrets (Replit Secrets)

### Critical (App won't work without these):
1. **GOOGLE_APPLICATION_CREDENTIALS**
   - Firebase service account JSON
   - Get from: Firebase Console → Project Settings → Service Accounts
   - Format: Complete JSON object as a string

2. **GEMINI_API_KEY**
   - Google AI Studio API key for market resolution
   - Get from: https://makersuite.google.com/app/apikey
   - Used for: Oracle market resolution with web search

### Optional (Features disabled without these):
3. **AI_INTEGRATIONS_OPENAI_API_KEY**
   - OpenAI API key for Swarm Agents and content moderation
   - Alternative: Use Replit AI Integrations (OpenAI blueprint)
   - Used for: Multi-agent verification, content moderation

4. **SENDGRID_API_KEY**
   - SendGrid API key for email delivery
   - Get from: https://sendgrid.com/
   - Used for: OTP codes, jury invitations

5. **ADMIN_SECRET**
   - Password for admin panel access
   - Set to any secure string
   - Used for: Admin authentication via ?admin=1 URL parameter

6. **CRON_SECRET**
   - Secret key for cron job authentication
   - Set to any secure string
   - Used for: Automated market resolution jobs

### Optional (Additional features):
7. **SENDGRID_API_KEY** - Email notifications (falls back to console logging)
8. **AI_INTEGRATIONS_OPENAI_BASE_URL** - Custom OpenAI endpoint (defaults to official API)

## API Endpoints

### Authentication
- `POST /api/auth/send-otp` - Send OTP to email
- `POST /api/auth/verify-otp` - Verify OTP and get Firebase token
- `POST /api/auth/signup` - Create new account

### Social Feed
- `POST /api/social/create-post` - Create social post
- `POST /api/social/react` - Add reaction to post
- `POST /api/social/comment` - Add comment to post
- `POST /api/social/delete-post` - Delete own post
- `POST /api/social/edit-post` - Edit own post
- `POST /api/social/delete-comment` - Delete own comment
- `POST /api/social/edit-comment` - Edit own comment

### Dispute & Jury System
- `POST /api/dispute-market` - Initiate market dispute
- `POST /api/verify-jury-code` - Verify jury invitation code

### Admin (requires x-admin-secret header)
- `POST /api/admin/resolve-market` - Manually resolve market
- `GET /api/admin/stats` - Get platform statistics
- `GET /api/admin/disputed-markets` - Get all disputed markets

### AI & Content
- `POST /api/moderate-content` - Moderate user-generated content
- `POST /api/gemini` - Proxy for Gemini AI
- `POST /api/run-jobs` - Trigger cron jobs (requires CRON_SECRET)

## Features Integrated

### ✅ Completed
- [x] Guest Mode (read-only browsing, no interactions without sign-in)
- [x] Demo Accounts (full access with isDemoAccount flag)
- [x] Email/OTP Authentication
- [x] Social Feed (posts, reactions, comments) - Secure backend APIs
- [x] Admin Panel (market resolution, stats)
- [x] Jury System (dispute handling, 5-juror voting)
- [x] AI Guardrails (content moderation)
- [x] API Endpoints (authentication, social, admin)
- [x] Login Page (standalone authentication UI)
- [x] Workflow Configuration (Express server on port 5000)
- [x] Social Feed Security (backend APIs, no direct Firebase writes)

### 🔨 Partially Implemented (Backend Complete)
- [ ] Swarm-Verify Oracle (multi-agent Byzantine consensus) - Backend ready, needs OpenAI key
- [ ] 30-Minute Dispute Window - Logic implemented, needs frontend UI
- [ ] Frontend Social Feed UI - Needs HTML/CSS/JS integration into app.html
- [ ] Frontend Admin Panel UI - Needs HTML/CSS/JS integration into app.html

## How to Set Up

1. **Set Required Secrets**:
   - Go to Replit Secrets (lock icon)
   - Add `GOOGLE_APPLICATION_CREDENTIALS` (Firebase JSON)
   - Add `GEMINI_API_KEY` (Google AI Studio)
   - Add `ADMIN_SECRET` (your choice, e.g., "admin123")

2. **Optional: Enable OpenAI Features**:
   - Add `AI_INTEGRATIONS_OPENAI_API_KEY` as secret
   - OR use Replit AI Integrations: Search for "OpenAI" integration

3. **Optional: Enable Email**:
   - Add `SENDGRID_API_KEY` to send actual emails
   - Without it, OTP codes will only appear in console logs

4. **Run the App**:
   - The workflow is already configured
   - Server runs on port 5000
   - Access: https://your-repl-url.replit.dev

## Admin Access
Access admin panel by adding `?admin=1` to the URL:
```
https://your-app.com/app.html?admin=1
```

Then enter the `ADMIN_SECRET` password when prompted.

## User Preferences
- **Color Scheme**: Sky blue (#38BDF8) with purple accents throughout the app
- **Landing Page Only**: Logo appears only on landing page, not in app
- **Guest Mode**: App opens in guest mode by default, no login screen flash

## Architecture

### Market Resolution Flow
```
Market Created
   ↓
Resolution Date Reaches
   ↓
Swarm-Verify Oracle (4 AI agents with Byzantine consensus)
   ↓
Confidence ≥ 90% → AUTO-RESOLVE + 30min Dispute Window
Confidence 85-90% → Manual Review
Confidence < 85% → Admin Review
   ↓
If Disputed → Select Top 5 Leaderboard Users as Jurors
   ↓
Jurors Vote (24-hour window)
   ↓
Majority Vote → Final Resolution
```

### Authentication Flow
```
User enters email
   ↓
Backend generates 6-digit OTP
   ↓
OTP sent via SendGrid (or logged to console)
   ↓
User enters OTP
   ↓
Backend verifies OTP
   ↓
Firebase Custom Token created
   ↓
User authenticated, redirected to /app.html
```

## Development Notes
- Server binds to `0.0.0.0:5000` for Replit compatibility
- Firebase initialization is graceful (app runs even if secrets missing)
- OpenAI integration is optional (features disabled if key missing)
- All database operations check for `db` existence before executing
- Cache-Control headers set to prevent iframe caching issues

## Next Steps (Recommended)
1. Set up all required secrets
2. Test authentication flow with login.html
3. Add frontend UI for Social Feed (integrate HTML/CSS/JS into app.html)
4. Add frontend UI for Admin Panel (integrate HTML/CSS/JS into app.html)
5. Test dispute flow and jury system
6. Configure deployment for production

## Contact
For issues or questions about this implementation, refer to the integration guides in `attached_assets/`.
