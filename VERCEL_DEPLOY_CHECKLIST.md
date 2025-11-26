# Vercel Deployment Environment Variables

Copy these environment variables to your Vercel project settings:

## Required (Critical - app won't work without these)

- [ ] **GEMINI_API_KEY** - Get value from Replit Secrets
- [ ] **GOOGLE_APPLICATION_CREDENTIALS** - Get value from Replit Secrets
- [ ] **CRON_SECRET** - Get value from Replit Secrets
- [ ] **ADMIN_SECRET** - Current value: `predora-admin`

## Optional but Recommended

- [ ] **SENDGRID_API_KEY** - For email notifications
  - Get from: https://sendgrid.com/
  - Create API key in SendGrid account
  - Then add here

- [ ] **OPENAI_API_KEY** - For AI features (optional if using Gemini)
  - Get value from Replit Secrets

## How to get values from Replit:

1. Go to your Replit project
2. Click "Secrets" (lock icon) at the top
3. Copy each secret value
4. Paste into corresponding Vercel environment variable

## After deploying:

- Test the app at your Vercel URL
- If emails aren't working, you likely need SENDGRID_API_KEY
- If AI features don't work, check GEMINI_API_KEY is set

## Notes:

- Make sure to set these for the environment you're deploying to (Production, Preview, etc.)
- Don't commit secrets to GitHub - only use Vercel's environment variable UI
