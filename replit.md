# Predora - Prediction Market Platform

## Overview
Predora is a decentralized prediction market platform featuring AI-powered market resolution, social functionalities, and a comprehensive admin panel. It leverages Firebase for data, OpenAI for swarm-based verification, and Google's Gemini AI for market resolution. The platform aims to offer quick play markets, a social feed, jury dispute resolution, and a 5-layer safety system, supported by automated market makers (AMM) for liquidity.

## User Preferences
- **Color Scheme**: Sky blue (#38BDF8) with purple accents throughout the app
- **Landing Page Only**: Logo appears only on landing page, not in app
- **Guest Mode**: App opens in guest mode by default, no login screen flash

## System Architecture

### UI/UX Decisions
- Landing page features a complete redesign with a stats section, expanded features (Quick Play, Swarm AI Oracle, Social Feed, Jury Disputes, 5-Layer Safety, AMM Liquidity), and a technology section highlighting AI and infrastructure.
- Gradient designs and floating animations for key elements like the home logo.
- Responsive design for optimal viewing across devices, including specific desktop layouts for the social feed.
- Glassmorphism design elements in CTA sections.
- Profile editing includes a beautiful modal with image upload preview and real-time validation.

### Technical Implementations
- **Market Resolution**: Utilizes a Swarm-Verify Oracle with 4 AI agents and Byzantine consensus. High confidence resolutions are auto-resolved with a 30-minute dispute window. Lower confidence or disputed markets go through a jury system of top leaderboard users.
- **Authentication**: Firebase Auth with custom tokens, supporting email/OTP verification. Guest mode provides read-only access.
- **Social Features**: APIs for creating posts, reactions, comments, and editing/deleting user content.
- **AI Guardrails**: A 5-layer content moderation pipeline (Pre-Filter, Keyword Blocklist, OpenAI Moderation API, Toxicity Detection, Admin Review) with safety tiers (GREEN, YELLOW, RED) and rate limiting to prevent abuse.
- **Market Dynamics**: Display of AMM pool liquidity and market momentum with color-coded indicators and simulated price fluctuations.
- **Profile Management**: Robust profile editing allowing username and profile picture updates, with data stored as base64 URLs in Firestore.

### Feature Specifications
- **Quick Polls Oracle**: Automated resolution of quick polls based on duration expiration and vote counts, with notifications to participants.
- **Admin Panel**: Features for manual market resolution, platform statistics, and managing disputed markets and safety reports.
- **Jury System**: Invitation-based system for resolving disputed markets, involving top leaderboard users for voting.
- **Security**: Comprehensive backend APIs ensure secure interactions, especially for social features, preventing direct Firebase writes from the frontend.

### System Design Choices
- **Project Structure**: Express.js backend (`index.js`), separate HTML files for the main application (`app.html`), login (`login.html`), and landing page (`index.html`).
- **Database Schema**: Organized Firestore collections for different data types (e.g., `standard_markets`, `user_profile`, `social_posts`, `safety_reports`).
- **Workflow**: Server runs on port 5000 for Replit compatibility. Graceful Firebase initialization and optional OpenAI integration ensure the app runs even with missing secrets.

## External Dependencies

- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **AI/ML**:
    - OpenAI (GPT-4o, GPT-4o-mini) for Swarm Agents and content moderation.
    - Google Gemini for oracle market resolution.
- **Backend Framework**: Node.js with Express.js
- **Frontend Framework**: Tailwind CSS, Vanilla JavaScript
- **Email Service**: SendGrid (optional, for OTP and notifications)