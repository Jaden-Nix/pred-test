# Predora - AI-Native Prediction Markets Platform

## Overview

Predora is a prediction markets platform that enables users to create markets, place bets, and have outcomes automatically resolved using AI-powered oracles. The platform emphasizes ease of use ("tap to bet, chat to earn") while leveraging Google's Gemini AI for content moderation, market resolution, and user assistance. Built as a full-stack web application with Firebase backend, the system includes sophisticated AI guardrails, swarm verification for oracle decisions, and automated cron jobs for market resolution.

##  Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack**: Vanilla HTML/CSS/JavaScript with Tailwind CSS
- **Decision**: No framework approach for rapid prototyping and minimal complexity
- **Rationale**: Hackathon/MVP build prioritizing speed over scalability
- **Pages**: Landing page (`index.html`), login (`login.html`), main app (`app.html`), and pitch deck
- **Styling**: Tailwind CSS via CDN with custom gradient animations and glassmorphism effects
- **State Management**: localStorage for demo users, sessionStorage for email users
- **Theme System**: Light/dark mode with pre-render script to prevent flash of unstyled content

### Backend Architecture

**Technology Stack**: Node.js + Express (ES modules)
- **Decision**: Express.js for RESTful API with middleware-based architecture
- **Rationale**: Simple, well-documented, and sufficient for current scale
- **File Structure**:
  - `index.js` - Main server with API routes
  - `ai-guardrails.js` - Content moderation system
  - `swarm-verify-oracle.js` - Multi-agent resolution verification
  - `cron-job.js` - Scheduled task runner

**AI Integration Pattern**: Multi-model AI strategy
- **Primary AI**: Google Gemini 2.5 Flash (free tier) for all AI operations
- **Use Cases**: Content moderation, market resolution, AI assistant chat
- **Architecture**: Direct API calls with retry logic and timeout handling
- **Swarm Verification**: Parallel agent consensus for high-stakes resolutions
  - Geometric median aggregation for confidence scoring
  - Second-pass review for low-confidence decisions
  - Multi-dimensional scoring (factual, consistency, timestamp, sentiment)

**Content Safety Architecture**: Multi-layer moderation pipeline
- **Pre-filtering**: Keyword blocklist for immediate rejection
- **Rate Limiting**: Per-user limits (markets/min, comments/min, requests/hour)
- **AI Moderation**: Gemini-based content analysis with safety thresholds
  - Auto-approve: >95% confidence
  - Manual review: 70-95% confidence
  - Block: <50% confidence
- **Event Logging**: Structured logging for safety events and decisions

### Authentication & Authorization

**Firebase Authentication** for user management
- **Decision**: Firebase Auth handles identity, custom user profiles stored separately
- **Methods Supported**: Email/password, demo users (URL parameters)
- **Storage Strategy**: 
  - Demo users: localStorage persistence
  - Email users: sessionStorage + localStorage fallback
- **Admin Access**: Environment variable-based admin secret for privileged operations

### Data Storage

**Firebase Firestore** (NoSQL document database)
- **Decision**: Firestore for real-time updates and Firebase ecosystem integration
- **Collections Structure**:
  - Markets collection with subcollections for bets and comments
  - Users collection for profiles and balances
  - Transactions for audit trail
- **Rationale**: Real-time listeners, offline support, and managed scaling
- **Note**: Application uses Firebase without traditional SQL database

### Scheduled Jobs & Automation

**Cron System**: node-cron + Replit Scheduled Deployment
- **Decision**: Dual approach - in-process cron and external scheduler
- **Jobs**: Market resolution, poll auto-resolution, oracle sweeps
- **Authentication**: Shared secret (`CRON_SECRET`) for job endpoints
- **Architecture**: `cron-job.js` calls `/api/run-jobs` endpoint with authentication
- **Frequency**: Configurable via Replit deployment settings

### Email System

**SendGrid Integration** with Replit Connector support
- **Decision**: SendGrid for transactional emails with connector-based credentials
- **Pattern**: Fresh credential fetch per request (no caching)
- **Fallback**: Direct API key if connector unavailable
- **Use Cases**: Email verification, notifications, market updates

## External Dependencies

### Third-Party APIs

1. **Google Gemini AI** (`@google/generative-ai`)
   - API: Gemini 2.5 Flash Preview (free tier)
   - Purpose: Content moderation, market resolution, AI chat assistant
   - Endpoint: `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025`
   - Configuration: Temperature control, timeout handling, retry logic

2. **SendGrid Email API** (`@sendgrid/mail`)
   - Purpose: Transactional emails
   - Integration: Replit Connector + direct API fallback
   - Authentication: Dynamic credential fetching

### Firebase Services

1. **Firebase Authentication**
   - User identity and session management
   - Email/password authentication

2. **Firebase Firestore**
   - Real-time NoSQL database
   - Document-based storage with subcollections

3. **Firebase Admin SDK** (`firebase-admin`)
   - Server-side Firebase operations
   - User management and database admin access

### Infrastructure & Deployment


. **Vercel** 
   - Configuration in `vercel.json`
   - Rewrites all routes to `index.js`

### Frontend CDN Dependencies

1. **Tailwind CSS** - Styling framework via CDN
2. **Google Fonts** - Outfit and Space Grotesk typefaces
3. **Lucide Icons** - Icon library

### Node.js Packages

- **express** - Web server framework
- **cors** - Cross-origin resource sharing
- **node-fetch** - HTTP client for external APIs
- **node-cron** - In-process job scheduling
- **crypto** - Built-in cryptographic operations