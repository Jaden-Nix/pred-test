

// --- ESM Imports ---
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';
import cron from 'node-cron';
import { 
    preFilterContent, 
    checkBlocklist, 
    moderateContent,
    checkRateLimit,
    checkMinuteLimit,
    logSafetyEvent
} from './ai-guardrails.js';
import { swarmVerifyResolution, secondPassReview } from './swarm-verify-oracle.js';

// --- Constants ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const GEMINI_BASE_URL = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const GEMINI_URL = GEMINI_BASE_URL 
    ? `${GEMINI_BASE_URL}/models/gemini-2.5-pro:generateContent`
    : "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
const APP_ID = 'predora-hackathon';

// In-memory OTP backup store (fallback when Firestore quota exceeded)
const otpMemoryStore = new Map();

// OpenAI removed - now using Gemini for all AI features including content moderation

// Initialize Gemini for AI Assistant Chat (supports both Replit AI Integrations and direct API key)
let geminiClient = null;
let geminiAiClient = null;
if (GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    // Use Replit AI Integrations (charges to your Replit credits)
    geminiAiClient = new GoogleGenAI({
        apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
        httpOptions: {
            apiVersion: "",
            baseUrl: GEMINI_BASE_URL,
        },
    });
    geminiClient = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
    console.log("✅ Gemini AI initialized via Replit AI Integrations (charges to your credits).");
} else if (process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log("✅ Gemini AI initialized with direct API key.");
} else {
    console.warn("⚠️ Gemini API key not set. AI Assistant will be disabled.");
}

// SendGrid connector function - gets fresh credentials each time (don't cache)
async function getUncachableSendGridClient() {
  try {
    // Try Replit connector first
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY 
      ? 'repl ' + process.env.REPL_IDENTITY 
      : process.env.WEB_REPL_RENEWAL 
      ? 'depl ' + process.env.WEB_REPL_RENEWAL 
      : null;

    if (xReplitToken) {
      try {
        const url = 'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid';
        const fetchRes = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'X_REPLIT_TOKEN': xReplitToken
          }
        });

        if (fetchRes.ok) {
          const data = await fetchRes.json();
          const connectionSettings = data.items?.[0];

          if (connectionSettings && connectionSettings.settings?.api_key && connectionSettings.settings?.from_email) {
            const apiKey = connectionSettings.settings.api_key;
            const fromEmail = connectionSettings.settings.from_email;
            sgMail.setApiKey(apiKey);
            console.log("✅ SendGrid client initialized from Replit connector");
            return { client: sgMail, fromEmail };
          }
        }
      } catch (connectorError) {
        console.warn("⚠️ Replit connector failed, trying environment variables:", connectorError.message);
      }
    }

    // Fallback to environment variables (for Vercel and other deployments)
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;

    if (!apiKey || !fromEmail) {
      console.warn("⚠️ SendGrid credentials not found (neither connector nor env vars available)");
      return null;
    }

    sgMail.setApiKey(apiKey);
    console.log("✅ SendGrid client initialized from environment variables");
    
    return { client: sgMail, fromEmail };
  } catch (error) {
    console.error("⚠️ SendGrid initialization error:", error.message, error.stack);
    return null;
  }
}

// --- Firebase Admin SDK Initialization ---
let db = null;
try {
    const serviceAccountString = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!serviceAccountString) {
        throw new Error("GOOGLE_APPLICATION_CREDENTIALS secret is not set.");
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log("✅ Firebase Admin SDK initialized successfully.");
} catch (e) {
    console.error("⚠️ Firebase Admin initialization failed:", e.message);
    console.log("⚠️ The app will run but database features will be disabled.");
    console.log("⚠️ Please set GOOGLE_APPLICATION_CREDENTIALS secret in Replit Secrets.");
}
const app = express();

// Increase payload size limit for image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

async function requireAuth(req, res, next) {
    const authToken = req.headers['authorization']?.replace('Bearer ', '') || req.body.authToken;
    const userId = req.body.userId || req.headers['x-demo-user-id'];
    
    // Allow demo users (alice-456, bob-789, guest-*) without Firebase token
    if (userId && (userId.startsWith('alice-') || userId.startsWith('bob-') || userId.startsWith('guest-'))) {
        req.user = {
            uid: userId,
            email: `${userId.split('-')[0]}@demo.predora.app`,
            isDemo: true
        };
        return next();
    }
    
    // Try Firebase token verification first
    if (authToken) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(authToken);
            req.user = {
                uid: decodedToken.uid,
                email: decodedToken.email
            };
            return next();
        } catch (error) {
            console.log('Firebase token verification failed, checking userId fallback');
        }
    }
    
    // Fallback: Accept userId from body for email OTP authenticated users
    // This supports users who logged in via OTP and have a valid session
    if (userId && userId.length > 5) {
        req.user = {
            uid: userId,
            email: userId.includes('@') ? userId : `${userId}@predora.app`,
            isEmailAuth: true
        };
        return next();
    }
    
    return res.status(401).json({ error: 'Authentication required' });
}

function requireFirebase(req, res, next) {
    if (!db) {
        return res.status(503).json({ 
            error: 'Database service unavailable. Please configure GOOGLE_APPLICATION_CREDENTIALS secret.' 
        });
    }
    next();
}

function requireAdmin(req, res, next) {
    const adminSecret = req.headers['x-admin-secret'];
    
    if (!ADMIN_SECRET || adminSecret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Admin authentication required' });
    }
    next();
}

// --- ROUTES (must be BEFORE static middleware) ---
app.get('/', (req, res) => {
    // Landing page first
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/home', (req, res) => {
    // For backwards compatibility
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

// Handle app.html with any query parameters (admin mode, demo users, etc.)
app.get(/^\/app\.html/, (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/pitch-deck', (req, res) => {
    res.sendFile(path.join(__dirname, 'pitch-deck', 'index.html'));
});

app.use(express.static(path.join(__dirname, '/')));


// --- NEW HELPER: Retry Logic for 503 Errors ---
async function fetchWithRetry(url, options, retries = 3, backoff = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            // If Google says "I'm busy" (503), wait and try again
            if (response.status === 503) {
                console.warn(`⚠️ Google API Overloaded (503). Retrying in ${backoff}ms... (Attempt ${i + 1}/${retries})`);
                await new Promise(r => setTimeout(r, backoff));
                backoff *= 1.5; // Wait longer next time
                continue;
            }

            return response;
        } catch (err) {
            if (i === retries - 1) throw err;
            console.warn(`⚠️ Network error. Retrying...`);
            await new Promise(r => setTimeout(r, backoff));
        }
    }
    throw new Error('Max retries reached. Google is too busy right now.');
}

// --- API Endpoint 1: Secure AI Proxy (Updated with Retry) ---
app.post('/api/gemini', async (req, res) => {
    console.log("Server: /api/gemini endpoint hit");

    const { systemPrompt, userPrompt, tools, jsonSchema } = req.body;

    if (!GEMINI_API_KEY) return res.status(500).json({ error: "API Key missing." });
    if (!systemPrompt || !userPrompt) return res.status(400).json({ error: "Missing prompts." });

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }]
    };

    if (jsonSchema) {
        payload.generationConfig = { responseMimeType: "application/json", responseSchema: jsonSchema };
    } else {
        payload.tools = tools; 
    }

    try {
        // USE THE RETRY FUNCTION HERE
        const googleResponse = await fetchWithRetry(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await googleResponse.json();

        if (!googleResponse.ok) {
            console.error("Google API Error:", data);
            return res.status(googleResponse.status).json(data);
        }
        res.status(200).json(data);

    } catch (error) {
        console.error("Error in /api/gemini:", error);
        res.status(503).json({ error: "AI Service Overloaded. Please try again in a moment." });
    }
});

// =============================================================================
// SWARM AGENTS - MARKET RESOLUTION ENDPOINTS
// =============================================================================

// Main Resolution Endpoint - Resolve single market using Swarm-Verify
app.get('/api/indexer/resolve-market/:marketId', requireFirebase, async (req, res) => {
    try {
        const { marketId } = req.params;
        const marketRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId);
        const marketSnap = await marketRef.get();
        
        if (!marketSnap.exists) {
            return res.status(404).json({ error: 'Market not found' });
        }

        if (!geminiClient) {
            return res.status(503).json({ error: 'Gemini API not configured. Swarm resolution unavailable.' });
        }

        const market = marketSnap.data();
        console.log(`🐝 Swarm-Verify resolving market: ${marketId}`);

        // Run Swarm-Verify
        const resolution = await swarmVerifyResolution(market, {
            geminiApiKey: GEMINI_API_KEY,
            geminiUrl: GEMINI_URL
        }, geminiClient);

        // Store resolution evidence
        const evidenceRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId).collection('resolutionEvidence').doc('swarm-verify-primary');
        await evidenceRef.set({
            resolution,
            timestamp: new Date(),
            version: 1
        });

        // Route based on confidence
        if (resolution.confidence >= 90) {
            // Path A: Auto-resolve
            console.log(`✅ AUTO-RESOLVE (${resolution.confidence}% confidence)`);
            await marketRef.update({
                isResolved: true,
                winningOutcome: resolution.outcome,
                resolutionMethod: 'swarm-verify-auto',
                resolvedAt: new Date(),
                status: 'resolved',
                swarmConfidence: resolution.confidence
            });

            res.json({
                status: 'resolved',
                outcome: resolution.outcome,
                confidence: resolution.confidence,
                path: 'auto-resolve',
                agentVotes: resolution.agentVotes,
                timestamp: new Date().toISOString()
            });

        } else if (resolution.confidence >= 85) {
            // Path A2: Second-pass + manual review
            console.log(`🔄 SECOND-PASS (${resolution.confidence}% confidence)`);
            const secondPass = await secondPassReview(market, resolution, geminiClient);
            
            const secondPassRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId).collection('resolutionEvidence').doc('swarm-verify-second-pass');
            await secondPassRef.set({
                resolution: secondPass,
                timestamp: new Date()
            });

            await marketRef.update({
                status: 'pending-review',
                swarmVerifyPassed: true,
                swarmConfidence: resolution.confidence,
                swarmOutcome: resolution.outcome,
                pendingReviewSince: new Date()
            });

            res.json({
                status: 'pending-manual',
                outcome: secondPass.outcome,
                confidence: secondPass.confidence,
                path: 'second-pass',
                agentVotes: resolution.agentVotes,
                timestamp: new Date().toISOString()
            });

        } else {
            // Path B: Full manual review
            console.log(`👥 MANUAL REVIEW (${resolution.confidence}% confidence - too low)`);
            await marketRef.update({
                status: 'pending-review',
                swarmVerifyPassed: false,
                swarmConfidence: resolution.confidence,
                swarmOutcome: resolution.outcome,
                pendingReviewSince: new Date()
            });

            res.json({
                status: 'pending-manual',
                outcome: resolution.outcome,
                confidence: resolution.confidence,
                path: 'manual-review',
                agentVotes: resolution.agentVotes,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('❌ Swarm resolution failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch Resolution Endpoint
app.post('/api/indexer/resolve-batch', requireFirebase, async (req, res) => {
    try {
        const { marketIds } = req.body;
        
        if (!Array.isArray(marketIds) || marketIds.length === 0) {
            return res.status(400).json({ error: 'marketIds array required' });
        }

        if (!geminiClient) {
            return res.status(503).json({ error: 'Gemini API not configured' });
        }

        const results = [];
        const collectionPath = `artifacts/${APP_ID}/public/data/standard_markets`;

        for (const marketId of marketIds) {
            try {
                const market = await db.collection(collectionPath).doc(marketId).get();
                
                if (!market.exists) {
                    results.push({
                        marketId,
                        error: 'Market not found',
                        status: 'failed'
                    });
                    continue;
                }

                const resolution = await swarmVerifyResolution(market.data(), {
                    geminiApiKey: GEMINI_API_KEY,
                    geminiUrl: GEMINI_URL
                }, geminiClient);

                results.push({
                    marketId,
                    status: 'success',
                    outcome: resolution.outcome,
                    confidence: resolution.confidence,
                    path: resolution.path
                });

            } catch (error) {
                results.push({
                    marketId,
                    error: error.message,
                    status: 'failed'
                });
            }
        }

        res.json({
            totalRequested: marketIds.length,
            totalResolved: results.filter(r => r.status === 'success').length,
            results
        });

    } catch (error) {
        console.error('Batch resolution error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Second Swarm Pass (Admin) - Request another swarm resolution for uncertain market
app.post('/api/admin/request-second-swarm', requireAdmin, requireFirebase, async (req, res) => {
    try {
        const { marketId } = req.body;

        if (!marketId) {
            return res.status(400).json({ error: 'marketId required' });
        }

        if (!geminiClient) {
            return res.status(503).json({ error: 'Gemini API not configured' });
        }

        const marketRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId);
        const marketSnap = await marketRef.get();

        if (!marketSnap.exists) {
            return res.status(404).json({ error: 'Market not found' });
        }

        const market = marketSnap.data();
        console.log(`🔄 Admin requesting second swarm pass for: ${marketId}`);

        const secondResolution = await swarmVerifyResolution(market, {
            geminiApiKey: GEMINI_API_KEY,
            geminiUrl: GEMINI_URL
        }, geminiClient);

        const evidenceRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId).collection('resolutionEvidence').doc(`swarm-verify-admin-${Date.now()}`);
        await evidenceRef.set({
            resolution: secondResolution,
            timestamp: new Date(),
            initiatedBy: 'admin'
        });

        res.json({
            marketId,
            status: 'completed',
            resolution: {
                outcome: secondResolution.outcome,
                confidence: secondResolution.confidence,
                agentVotes: secondResolution.agentVotes,
                path: secondResolution.path
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Admin second swarm error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Internal Helper (Updated with Retry) ---
async function callGoogleApi(payload) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");

    // Build URL and headers based on whether using Replit AI Integrations or direct API
    let apiUrl, headers;
    if (GEMINI_BASE_URL) {
        // Replit AI Integrations - use bearer token auth
        apiUrl = `${GEMINI_BASE_URL}/models/gemini-2.5-pro:generateContent`;
        headers = { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GEMINI_API_KEY}`
        };
    } else {
        // Direct Google API - use API key in URL
        apiUrl = `${GEMINI_URL}?key=${GEMINI_API_KEY}`;
        headers = { 'Content-Type': 'application/json' };
    }

    // USE THE RETRY FUNCTION HERE TOO
    const googleResponse = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    const data = await googleResponse.json();

    if (!googleResponse.ok) {
        console.error("Oracle Google API Error:", data);
        throw new Error(`Google API Error: ${data.error?.message || 'Unknown error'}`);
    }

    return data;
}

// --- ORACLE JOBS (Same logic as before, but using the robust callGoogleApi) ---

async function autoResolveMarkets() {
    console.log("ORACLE: Running autoResolveMarkets...");
    const today = new Date().toISOString().split('T')[0];
    const collectionPath = `artifacts/${APP_ID}/public/data/standard_markets`;
    const snapshot = await db.collection(collectionPath).where('isResolved', '==', false).get();

    if (snapshot.empty) return console.log("ORACLE: No unresolved markets.");

    const marketsToResolve = snapshot.docs.filter(doc => doc.data().resolutionDate <= today);
    console.log(`ORACLE: Resolving ${marketsToResolve.length} markets...`);

    for (const doc of marketsToResolve) {
        const market = doc.data();
        const marketId = doc.id;

        try {
            // Logic condensed for brevity - exact same as previous version
            const systemPrompt = `As of ${today}, verify the outcome of: "${market.title}". Respond ONLY 'YES', 'NO', 'AMBIGUOUS'.`;
            const payload = {
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: "user", parts: [{ text: `Market: "${market.title}"` }] }],
                tools: [{ "google_search": {} }]
            };

            const response = await callGoogleApi(payload);
            const outcome = response.candidates[0].content.parts[0].text.trim().toUpperCase();

            if (outcome === 'YES' || outcome === 'NO') {
                // Payout logic: distribute winnings proportionally to stake size
                try {
                    const pledgesRef = db.collection(`artifacts/${APP_ID}/public/data/pledges`);
                    const pledgeSnaps = await pledgesRef.where('marketId', '==', marketId).get();
                    
                    // Process each pledge and calculate totals
                    const allPledges = pledgeSnaps.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    
                    // Calculate total stakes for winners and losers
                    let totalWinningStakeUsd = 0;
                    let totalLosingStakeUsd = 0;
                    const winners = [];
                    
                    for (const pledge of allPledges) {
                        const stakeUsd = pledge.amountUsd || pledge.amount || 0;
                        if (pledge.pick === outcome) {
                            winners.push(pledge);
                            totalWinningStakeUsd += stakeUsd;
                        } else {
                            totalLosingStakeUsd += stakeUsd;
                        }
                    }
                    
                    const totalPoolUsd = totalWinningStakeUsd + totalLosingStakeUsd;
                    
                    // Use batch writes for atomicity
                    const batch = db.batch();
                    const userStatsMap = new Map(); // Track cumulative stats per user for final update
                    
                    // First pass: Calculate proportional payouts per user across all their pledges
                    for (const pledge of allPledges) {
                        const userId = pledge.userId;
                        const isWinner = pledge.pick === outcome;
                        const stakeUsd = pledge.amountUsd || pledge.amount || 0;
                        
                        if (!userStatsMap.has(userId)) {
                            userStatsMap.set(userId, { wins: 0, losses: 0, profit: 0 });
                        }
                        
                        const userStats = userStatsMap.get(userId);
                        if (isWinner) {
                            userStats.wins++;
                            // Proportional payout: stake + (stake / totalWinningStake) * losingPool
                            // This gives winners their stake back plus a proportional share of losing pool
                            const stakeShare = totalWinningStakeUsd > 0 ? stakeUsd / totalWinningStakeUsd : 0;
                            const winnings = stakeShare * totalLosingStakeUsd;
                            userStats.profit += stakeUsd + winnings; // Return stake + winnings
                        } else {
                            userStats.losses++;
                            // Losers get nothing (their stake went to winners)
                        }
                    }
                    
                    // Second pass: Apply batch updates for each user
                    for (const [userId, stats] of userStatsMap) {
                        const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(userId);
                        const publicUserRef = db.collection(`artifacts/${APP_ID}/public/data/leaderboard`).doc(userId);
                        const userSnap = await userRef.get();
                        
                        if (userSnap.exists) {
                            const userData = userSnap.data();
                            const currentStreak = userData.streak || 0;
                            const hasMoreWins = stats.wins > stats.losses;
                            
                            // Build incremental updates
                            const updates = {
                                xp: admin.firestore.FieldValue.increment(hasMoreWins ? 50 : 10),
                                totalWins: admin.firestore.FieldValue.increment(stats.wins),
                                totalLosses: admin.firestore.FieldValue.increment(stats.losses),
                                totalProfit: admin.firestore.FieldValue.increment(stats.profit)
                            };
                            
                            // Update balance and streak
                            if (stats.profit > 0) {
                                updates.balance = admin.firestore.FieldValue.increment(stats.profit);
                            }
                            updates.streak = hasMoreWins ? currentStreak + 1 : 0;
                            
                            // Batch update
                            batch.update(userRef, updates);
                            
                            // Public leaderboard (exclude balance)
                            const publicUpdates = { ...updates };
                            delete publicUpdates.balance;
                            batch.set(publicUserRef, publicUpdates, { merge: true });
                        }
                    }
                    
                    // Commit atomically
                    await batch.commit();
                    console.log(`✅ ORACLE: Updated stats for ${userStatsMap.size} users on market ${marketId}`);
                } catch (payoutError) {
                    console.error(`ORACLE: Payout failed for ${marketId}:`, payoutError.message);
                }
                
                // 📢 SEND NOTIFICATIONS to all users who staked on this market
                try {
                    const allPledgesRef = db.collection(`artifacts/${APP_ID}/public/data/pledges`);
                    const allPledges = await allPledgesRef.where('marketId', '==', marketId).get();
                    
                    const notifiedUsers = new Set();
                    const batch = db.batch();
                    
                    for (const pledgeSnap of allPledges.docs) {
                        const pledge = pledgeSnap.data();
                        const userIdToNotify = pledge.userId;
                        
                        // Validate userId exists and is a string
                        if (!userIdToNotify || typeof userIdToNotify !== 'string') {
                            console.warn(`⚠️ Invalid userId in pledge:`, userIdToNotify);
                            continue;
                        }
                        
                        // Only send one notification per user even if they staked multiple times
                        if (!notifiedUsers.has(userIdToNotify)) {
                            notifiedUsers.add(userIdToNotify);
                            
                            // Create notification for user using batch write
                            const notificationsRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile/${userIdToNotify}/notifications`).doc();
                            batch.set(notificationsRef, {
                                type: 'market_resolved',
                                marketId: marketId,
                                marketTitle: market.title,
                                outcome: outcome,
                                message: `Market resolved: "${market.title}" - Winner: ${outcome}`,
                                actionUrl: `screen:market-detail:${marketId}`,
                                timestamp: new Date(),
                                read: false
                            });
                        }
                    }
                    
                    // Commit batch write
                    if (notifiedUsers.size > 0) {
                        await batch.commit();
                        console.log(`📢 Market resolution notifications committed to ${notifiedUsers.size} users for ${market.title}`);
                        
                        // Send email notifications asynchronously (don't block)
                        sendMarketResolutionEmails(notifiedUsers, market.title, outcome).catch(err => {
                            console.warn(`⚠️ Email notification async error:`, err.message);
                        });
                    }
                } catch (notifError) {
                    console.error(`⚠️ Failed to send market resolution notifications:`, notifError.message);
                }
                
                 await doc.ref.update({ isResolved: true, winningOutcome: outcome, resolvedAt: new Date() });
                 console.log(`ORACLE: Resolved ${market.title} as ${outcome}`);
            }
        } catch (e) {
            console.error(`ORACLE: Failed market ${marketId}:`, e.message);
        }
    }
}

// --- ORACLE: Auto-Resolve Quick Polls ---
async function autoResolveQuickPolls() {
    console.log("🗳️ ORACLE: Running autoResolveQuickPolls...");
    
    if (!db) {
        console.warn("⚠️ Database not initialized, skipping quick polls resolution");
        return;
    }

    try {
        const collectionPath = `artifacts/${APP_ID}/public/data/quick_polls`;
        const snapshot = await db.collection(collectionPath).where('isResolved', '==', false).get();

        if (snapshot.empty) {
            console.log("🗳️ ORACLE: No unresolved quick polls.");
            return;
        }

        const now = new Date();
        const pollsToResolve = [];

        // Filter polls that have exceeded their duration
        for (const doc of snapshot.docs) {
            const poll = doc.data();
            const createdAt = poll.createdAt?.toDate?.() || new Date(poll.createdAt);
            const durationMinutes = parseInt(poll.duration) || 60;
            const expirationTime = new Date(createdAt.getTime() + durationMinutes * 60 * 1000);

            if (now >= expirationTime) {
                pollsToResolve.push({ id: doc.id, ...poll });
            }
        }

        console.log(`🗳️ ORACLE: Found ${pollsToResolve.length} polls ready for resolution`);

        // Resolve each poll
        for (const poll of pollsToResolve) {
            try {
                // Determine winner (YES or NO) based on vote count
                const yesVotes = poll.yesVotes || 0;
                const noVotes = poll.noVotes || 0;
                const xpStakedYES = poll.xpStakedYES || 0;
                const xpStakedNO = poll.xpStakedNO || 0;
                let winningOption = null;

                if (yesVotes > noVotes) {
                    winningOption = 'YES';
                } else if (noVotes > yesVotes) {
                    winningOption = 'NO';
                } else {
                    // Tie: return all XP to voters (no redistribution)
                    winningOption = 'TIE';
                }

                // Distribute XP rewards
                const voters = poll.voters || {};
                const batch = db.batch();
                let winnerCount = 0;
                let totalWinningsDistributed = 0;
                
                if (winningOption !== 'TIE') {
                    // Calculate pot sizes
                    const losingXPPot = winningOption === 'YES' ? xpStakedNO : xpStakedYES;
                    const winningXPPot = winningOption === 'YES' ? xpStakedYES : xpStakedNO;
                    
                    // Count winners
                    for (const userId in voters) {
                        if (voters[userId].vote === winningOption) {
                            winnerCount++;
                        }
                    }

                    // Distribute winnings to winners
                    if (winnerCount > 0 && losingXPPot > 0) {
                        const winningsPerWinner = losingXPPot / winnerCount;

                        for (const userId in voters) {
                            const voter = voters[userId];
                            if (voter.vote === winningOption) {
                                // Winner gets: stake back + share of loser's pot
                                const totalReward = (voter.xpStaked || 0) + winningsPerWinner;
                                totalWinningsDistributed += totalReward;

                                // Update user profile XP
                                const profileRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(userId);
                                batch.set(profileRef, { xp: admin.firestore.FieldValue.increment(totalReward) }, { merge: true });

                                // Update leaderboard XP
                                const leaderboardRef = db.collection(`artifacts/${APP_ID}/public/data/leaderboard`).doc(userId);
                                batch.set(leaderboardRef, { xp: admin.firestore.FieldValue.increment(totalReward) }, { merge: true });

                                console.log(`💰 ORACLE: User ${userId} won ${Math.round(totalReward)} XP on poll (${voter.xpStaked} stake + ${Math.round(winningsPerWinner)} share)`);
                            }
                        }
                    }
                } else {
                    // Tie: return all staked XP to participants
                    for (const userId in voters) {
                        const voter = voters[userId];
                        const xpStaked = voter.xpStaked || 0;
                        if (xpStaked > 0) {
                            totalWinningsDistributed += xpStaked;
                            
                            const profileRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(userId);
                            batch.set(profileRef, { xp: admin.firestore.FieldValue.increment(xpStaked) }, { merge: true });

                            const leaderboardRef = db.collection(`artifacts/${APP_ID}/public/data/leaderboard`).doc(userId);
                            batch.set(leaderboardRef, { xp: admin.firestore.FieldValue.increment(xpStaked) }, { merge: true });

                            console.log(`🤝 ORACLE: User ${userId} got back ${xpStaked} XP (tie result)`);
                        }
                    }
                }

                // Update the poll with resolution
                const pollRef = db.collection(collectionPath).doc(poll.id);
                batch.update(pollRef, {
                    isResolved: true,
                    winningOption: winningOption,
                    resolvedAt: new Date(),
                    yesVotesCount: yesVotes,
                    noVotesCount: noVotes,
                    totalXPDistributed: totalWinningsDistributed
                });

                console.log(`✅ ORACLE: Resolved poll "${poll.question || poll.title}" - Winner: ${winningOption} (YES: ${yesVotes} votes/${xpStakedYES}XP, NO: ${noVotes} votes/${xpStakedNO}XP)`);

                // Send notifications to all voters
                const notifiedUsers = new Set();
                for (const userId in voters) {
                    notifiedUsers.add(userId);
                    const voter = voters[userId];
                    const isWinner = voter.vote === winningOption;
                    
                    const notificationsRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile/${userId}/notifications`).doc();
                    const winningsPerWinner = winningOption !== 'TIE' && (winningOption === 'YES' ? xpStakedNO : xpStakedYES) > 0 && winnerCount > 0 
                        ? ((winningOption === 'YES' ? xpStakedNO : xpStakedYES) / winnerCount) + (voter.xpStaked || 0)
                        : voter.xpStaked || 0;

                    batch.set(notificationsRef, {
                        type: 'poll_resolved',
                        pollId: poll.id,
                        pollTitle: poll.question || poll.title,
                        winningOption: winningOption,
                        userVote: voter.vote,
                        xpResult: isWinner || winningOption === 'TIE' ? Math.round(winningsPerWinner) : 0,
                        message: isWinner || winningOption === 'TIE' 
                            ? `🎉 Poll resolved: "${poll.question || poll.title}" - Your ${voter.vote} was correct! +${Math.round(winningsPerWinner)} XP`
                            : `📊 Poll resolved: "${poll.question || poll.title}" - ${winningOption} won. Better luck next time!`,
                        actionUrl: `screen:quick-polls`,
                        timestamp: new Date(),
                        read: false
                    });
                }

                // Commit all updates
                await batch.commit();
                console.log(`📢 ORACLE: Sent notifications to ${notifiedUsers.size} voters | Distributed ${Math.round(totalWinningsDistributed)} total XP`);

            } catch (pollError) {
                console.error(`🗳️ ORACLE: Failed to resolve poll ${poll.id}:`, pollError.message);
            }
        }

    } catch (error) {
        console.error("🗳️ ORACLE: autoResolveQuickPolls failed:", error.message);
    }
}

// Enhanced market data fetch with sentiment, volatility, and technical analysis
async function getAdvancedMarketData() {
    try {
        // Fetch comprehensive market data from CoinGecko
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?ids=bitcoin,ethereum&vs_currency=usd&order=market_cap_desc&per_page=2&sparkline=true&price_change_percentage=1h,24h,7d');
        const data = await response.json();
        
        const btcData = data[0];
        const ethData = data[1];
        
        const btcPrice = btcData.current_price;
        const ethPrice = ethData.current_price;
        const btc24hChange = btcData.price_change_percentage_24h || 0;
        const eth24hChange = ethData.price_change_percentage_24h || 0;
        const btc7dChange = btcData.price_change_percentage_7d_in_currency || 0;
        const eth7dChange = ethData.price_change_percentage_7d_in_currency || 0;
        
        // Calculate volatility from 7-day sparkline
        const btcSparkline = btcData.sparkline_in_7d?.price || [];
        const ethSparkline = ethData.sparkline_in_7d?.price || [];
        
        const calculateVolatility = (prices) => {
            if (!prices || prices.length < 2) return 15;
            const returns = [];
            for (let i = 1; i < prices.length; i++) {
                returns.push((prices[i] - prices[i-1]) / prices[i-1]);
            }
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
            return Math.sqrt(variance) * 100; // Daily volatility %
        };
        
        const btcVolatility = calculateVolatility(btcSparkline);
        const ethVolatility = calculateVolatility(ethSparkline);
        
        // Determine market sentiment (simplified Fear & Greed)
        const getSentiment = (change24h) => {
            if (change24h > 5) return { label: 'EXTREME_GREED', score: 80 };
            if (change24h > 2) return { label: 'GREED', score: 65 };
            if (change24h > 0) return { label: 'NEUTRAL', score: 50 };
            if (change24h > -2) return { label: 'FEAR', score: 35 };
            return { label: 'EXTREME_FEAR', score: 20 };
        };
        
        const btcSentiment = getSentiment(btc24hChange);
        const ethSentiment = getSentiment(eth24hChange);
        
        // Calculate key levels (support/resistance)
        const btc52wHigh = btcPrice * 1.4; // Approximate
        const btc52wLow = btcPrice * 0.7;
        const eth52wHigh = ethPrice * 1.4;
        const eth52wLow = ethPrice * 0.7;
        
        return {
            btc: {
                price: btcPrice,
                change24h: btc24hChange,
                change7d: btc7dChange,
                volatility: btcVolatility,
                sentiment: btcSentiment,
                support: btc52wLow,
                resistance: btc52wHigh,
                marketCap: btcData.market_cap || 1750000000000
            },
            eth: {
                price: ethPrice,
                change24h: eth24hChange,
                change7d: eth7dChange,
                volatility: ethVolatility,
                sentiment: ethSentiment,
                support: eth52wLow,
                resistance: eth52wHigh,
                marketCap: ethData.market_cap || 140000000000
            }
        };
    } catch (error) {
        console.warn("⚠️ Failed to fetch advanced market data:", error.message);
        return {
            btc: { price: 88000, change24h: 1.5, change7d: -2, volatility: 15, sentiment: { label: 'NEUTRAL', score: 50 }, support: 61600, resistance: 123200, marketCap: 1750000000000 },
            eth: { price: 3300, change24h: 2, change7d: -1, volatility: 12, sentiment: { label: 'NEUTRAL', score: 50 }, support: 2310, resistance: 4620, marketCap: 140000000000 }
        };
    }
}

// Create daily markets with AI-generated trending questions
async function createDailyMarkets() {
    console.log("ORACLE: Creating daily markets with ADVANCED AI analysis...");
    
    try {
        // MAX MARKET LIMIT CHECK - prevent spam
        const MAX_ACTIVE_MARKETS = 50; // Maximum active markets allowed
        const activeMarketsSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/standard_markets`)
            .where('isResolved', '==', false)
            .get();
        
        if (activeMarketsSnapshot.size >= MAX_ACTIVE_MARKETS) {
            console.log(`⏸️ ORACLE PAUSED: Already have ${activeMarketsSnapshot.size} active markets (max: ${MAX_ACTIVE_MARKETS})`);
            console.log(`   Skipping market creation to prevent spam. Markets will auto-create when some resolve.`);
            return; // Exit early - don't create more markets
        }
        
        console.log(`📊 Active markets: ${activeMarketsSnapshot.size}/${MAX_ACTIVE_MARKETS} - Creating new markets...`);
        
        // Get advanced market data with sentiment and technical analysis
        const marketData = await getAdvancedMarketData();
        console.log(`📊 Market Analysis:`);
        console.log(`   BTC: $${Math.round(marketData.btc.price)} (24h: ${marketData.btc.change24h.toFixed(2)}%) | Volatility: ${marketData.btc.volatility.toFixed(1)}% | Sentiment: ${marketData.btc.sentiment.label}`);
        console.log(`   ETH: $${Math.round(marketData.eth.price)} (24h: ${marketData.eth.change24h.toFixed(2)}%) | Volatility: ${marketData.eth.volatility.toFixed(1)}% | Sentiment: ${marketData.eth.sentiment.label}`);
        
        // Build advanced prompt with technical + sentiment analysis
        const systemPrompt = `You are an ADVANCED prediction market analyst across ALL categories:
- Crypto/Finance: Technical analysis, sentiment, market data
- Sports: Teams, games, outcomes, league predictions
- Entertainment: Awards, releases, celebrity events, streaming hits
- Tech: Product launches, company announcements, AI developments
- Politics: Elections, legislation, political events
- Gaming: Esports, game releases, gaming tournaments, streaming
- Social: Trends, influencers, social movements, cultural events
- Other: Weather, news, viral trends

Generate 5 HOTTEST, MOST TRADABLE prediction market questions across DIVERSE CATEGORIES.

RULES:
1. Use ONLY real market data provided for crypto - NO hallucinated numbers
2. Create realistic targets considering all available data
3. Make predictions that are plausible but exciting
4. DIVERSITY: Cover at least 3+ different categories (crypto, sports, entertainment, tech, politics, gaming)
5. Mix binary YES/NO AND multi-option questions (3-4 outcomes)
6. Balance between different timeframes

Return ONLY a JSON array with objects containing:
- title: specific, time-bound prediction question
- category: Crypto/Tech/Finance/Sports/Entertainment/Politics/Gaming/Social/Other
- description: short analysis explaining why this matters
- confidence: HIGH/MEDIUM/LOW
- type: binary (YES/NO) or multi (3-4 options)
- options: [for multi-option only] array of 3-4 outcome names

Example binary: [{"title": "Will BTC hit X by date?", "category": "Crypto", "description": "...", "confidence": "HIGH", "type": "binary"}]
Example multi: [{"title": "Which team wins...", "category": "Sports", "type": "multi", "options": ["Team A", "Team B", "Team C"]}]`;

        const userPrompt = `TODAY: November 25, 2025

CRYPTO MARKET DATA (for reference):
Bitcoin: $${Math.round(marketData.btc.price)} (24h: ${marketData.btc.change24h.toFixed(2)}%) | Sentiment: ${marketData.btc.sentiment.label}
Ethereum: $${Math.round(marketData.eth.price)} (24h: ${marketData.eth.change24h.toFixed(2)}%) | Sentiment: ${marketData.eth.sentiment.label}

TASK: Generate 5 SMART prediction markets for December 2025.
REQUIREMENTS:
- Mix categories: generate crypto, sports, entertainment, tech, and other predictions
- Include 3 BINARY markets (YES/NO) and 2 MULTI-OPTION markets (3-4 outcomes each)
- Make them INTERESTING and TRADABLE - focus on hot topics people care about
- For sports: use real upcoming games/tournaments in Dec 2025
- For entertainment: use real events (awards, releases, streaming)
- For tech: use real company announcements or AI developments
- All dates must be in December 2025 or early Jan 2026`;

        const payload = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const response = await callGoogleApi(payload);
        let aiMarkets = [];

        try {
            const jsonText = response.candidates[0].content.parts[0].text;
            aiMarkets = JSON.parse(jsonText);
        } catch (parseError) {
            console.warn("⚠️ Failed to parse AI response, using fallback markets");
            aiMarkets = [
                { title: "Will Bitcoin break $100k this week?", category: "Crypto", description: "Bitcoin price breakout" },
                { title: "Will a major tech layoff happen this week?", category: "Tech", description: "Tech company news" },
                { title: "Will a new AI model outperform GPT-4?", category: "Tech", description: "AI competition" }
            ];
        }

        for (const marketData of aiMarkets) {
            try {
                const marketRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc();
                const resolutionDate = new Date();
                resolutionDate.setDate(resolutionDate.getDate() + 45); // Resolve in 45 days for standard markets
                
                // Validate resolution date is in the future
                if (resolutionDate < new Date()) {
                    console.warn(`⚠️ Skipping market with past date: ${resolutionDate}`);
                    continue;
                }

                // Handle both binary and multi-option markets
                if (marketData.type === 'multi' && marketData.options && marketData.options.length > 0) {
                    // Multi-option market - NO yesPercent/noPercent (those are for binary markets only!)
                    const poolPerOption = 5000; // $5k per option
                    const optionAmounts = marketData.options.reduce((acc, opt) => {
                        acc[opt] = poolPerOption;
                        return acc;
                    }, {});
                    const totalPool = poolPerOption * marketData.options.length;
                    
                    await marketRef.set({
                        id: marketRef.id,
                        title: marketData.title || "Prediction Market",
                        category: marketData.category || "General",
                        description: marketData.description || "",
                        createdByDisplayName: 'PredoraOracle',
                        createdAt: new Date(),
                        isResolved: false,
                        resolutionDate: resolutionDate.toISOString().split('T')[0],
                        status: 'active',
                        marketType: 'multi',
                        marketStructure: 'multi-option',
                        options: marketData.options,
                        optionAmounts: optionAmounts,
                        totalPool: totalPool,
                        totalStakeVolume: totalPool,
                        isMock: false
                    });
                    console.log(`✅ Created multi-option market: ${marketData.title} (Options: ${marketData.options.join(', ')})`);
                } else {
                    // Binary YES/NO market - WITH VALIDATION
                    const yesPool = 10000;
                    const noPool = 10000;
                    const totalPool = 20000;
                    
                    // Safety check: ensure pools are valid finite numbers
                    if (!Number.isFinite(yesPool) || !Number.isFinite(noPool) || !Number.isFinite(totalPool) ||
                        yesPool <= 0 || noPool <= 0 || totalPool <= 0) {
                        console.error(`⚠️ Invalid pool values for market ${marketData.title}, skipping`);
                        continue;
                    }
                    
                    await marketRef.set({
                        id: marketRef.id,
                        title: marketData.title || "Prediction Market",
                        category: marketData.category || "General",
                        description: marketData.description || "",
                        createdByDisplayName: 'PredoraOracle',
                        createdAt: new Date(),
                        isResolved: false,
                        resolutionDate: resolutionDate.toISOString().split('T')[0],
                        status: 'active',
                        yesPool: yesPool,
                        noPool: noPool,
                        yesPercent: 50,
                        noPercent: 50,
                        totalPool: totalPool,
                        totalStakeVolume: totalPool,
                        marketType: 'binary',
                        isMock: false
                    });
                }

                console.log(`✅ Created market: ${marketData.title} (Resolves: ${resolutionDate.toISOString().split('T')[0]})`);
            } catch (marketError) {
                console.error(`⚠️ Failed to create market: ${marketError.message}`);
            }
        }
    } catch (error) {
        console.error("ORACLE: Failed to create daily markets:", error.message);
    }
}

// Auto-generate quick play markets (24-48 hour markets) with AI
async function autoGenerateQuickPlays() {
    console.log("ORACLE: Generating quick play markets with AI...");
    
    try {
        // MAX MARKET LIMIT CHECK - prevent spam
        const MAX_ACTIVE_QUICK_PLAYS = 30; // Maximum active quick play markets allowed
        const activeQuickPlaysSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/quick_play_markets`)
            .where('isResolved', '==', false)
            .get();
        
        if (activeQuickPlaysSnapshot.size >= MAX_ACTIVE_QUICK_PLAYS) {
            console.log(`⏸️ QUICK PLAY ORACLE PAUSED: Already have ${activeQuickPlaysSnapshot.size} active quick plays (max: ${MAX_ACTIVE_QUICK_PLAYS})`);
            console.log(`   Skipping quick play creation to prevent spam. Markets will auto-create when some resolve.`);
            return; // Exit early - don't create more markets
        }
        
        console.log(`⚡ Active quick plays: ${activeQuickPlaysSnapshot.size}/${MAX_ACTIVE_QUICK_PLAYS} - Creating new quick plays...`);
        
        // Get advanced market data for quick plays
        const qpMarketData = await getAdvancedMarketData();
        
        // Use Gemini to generate DIVERSE quick play questions
        const systemPrompt = `You are an EXPERT quick play market specialist across ALL categories. Generate 6 HOTTEST quick-play predictions (24-48 hour resolution).

EXPERTISE:
- Intraday crypto volatility and momentum
- Real-time sports events and games
- Entertainment news and trending topics
- Gaming/Esports tournaments and events
- Market catalysts and news events
- Statistical probability of moves
- Risk/reward optimization

RULES:
1. Use ONLY the real market data provided for crypto
2. Price targets must be realistic for 24-48h timeframes
3. Consider daily volatility when setting targets
4. DIVERSITY: Include crypto, sports, entertainment, and gaming quick plays
5. Focus on HIGH-PROBABILITY + HIGH-INTEREST events
6. Create events happening Nov 26-27, 2025

Return ONLY a JSON array with:
- title: specific, short-term prediction
- category: Crypto/Tech/Finance/Sports/Entertainment/Gaming
- duration: 24h/48h
- type: binary or multi
- options: [for multi only] array of outcomes
- rationale: why this move is likely

Example binary: [{"title": "Will BTC stay above $X on Nov 26?", "category": "Crypto", "duration": "24h", "type": "binary"}]
Example multi: [{"title": "Which team wins...", "category": "Sports", "duration": "24h", "type": "multi", "options": ["Team A", "Team B"]}]`;

        const userPrompt = `TODAY: November 25, 2025 - Generate quick plays for Nov 26-27 events

CRYPTO DATA:
Bitcoin: $${Math.round(qpMarketData.btc.price)} | 24h: ${qpMarketData.btc.change24h.toFixed(2)}% | Volatility: ${qpMarketData.btc.volatility.toFixed(1)}%
Ethereum: $${Math.round(qpMarketData.eth.price)} | 24h: ${qpMarketData.eth.change24h.toFixed(2)}% | Volatility: ${qpMarketData.eth.volatility.toFixed(1)}%

TASK: Generate 6 SMART quick plays for Nov 26-27:
- 2-3 crypto/finance quick plays (24h duration) with realistic price targets
- 2-3 sports/entertainment quick plays (24h-48h) with multi-option outcomes
- Make them HIGH-ENERGY and TRADABLE
- Mix binary and multi-option formats`;

        const payload = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const response = await callGoogleApi(payload);
        let aiQuickPlays = [];

        try {
            const jsonText = response.candidates[0].content.parts[0].text;
            aiQuickPlays = JSON.parse(jsonText);
        } catch (parseError) {
            console.warn("⚠️ Failed to parse AI response, using fallback quick plays");
            aiQuickPlays = [
                { title: "Will Bitcoin pump tomorrow?", category: "Crypto", duration: "24h" },
                { title: "Will the Dow Jones close green?", category: "Finance", duration: "24h" },
                { title: "Will Elon tweet about crypto?", category: "Tech", duration: "12h" },
                { title: "Will a major sports upset happen?", category: "Sports", duration: "48h" }
            ];
        }

        for (const marketData of aiQuickPlays) {
            try {
                const marketRef = db.collection(`artifacts/${APP_ID}/public/data/quick_play_markets`).doc();
                const now = new Date();
                const futureDate = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours max
                
                // Handle both binary and multi-option quick plays
                if (marketData.type === 'multi' && marketData.options && marketData.options.length > 0) {
                    // Multi-option quick play - NO yesPercent/noPercent (those are for binary markets only!)
                    const poolPerOption = 5000;
                    const optionAmounts = marketData.options.reduce((acc, opt) => {
                        acc[opt] = poolPerOption;
                        return acc;
                    }, {});
                    const totalPool = poolPerOption * marketData.options.length;
                    
                    await marketRef.set({
                        id: marketRef.id,
                        title: marketData.title || "Quick Play Market",
                        category: marketData.category || "General",
                        duration: marketData.duration || "24h",
                        createdByDisplayName: 'PredoraOracle',
                        createdAt: now,
                        resolutionDate: futureDate.toISOString().split('T')[0],
                        isResolved: false,
                        status: 'active',
                        marketType: 'multi',
                        marketStructure: 'multi-option',
                        options: marketData.options,
                        optionAmounts: optionAmounts,
                        totalPool: totalPool,
                        totalStakeVolume: totalPool,
                        isMock: false
                    });
                    console.log(`✅ Created quick play (MULTI): ${marketData.title} (Options: ${marketData.options.join(', ')})`);
                } else {
                    // Binary quick play - WITH VALIDATION
                    const yesPool = 10000;
                    const noPool = 10000;
                    const totalPool = 20000;
                    
                    // Safety check: ensure pools are valid finite numbers
                    if (!Number.isFinite(yesPool) || !Number.isFinite(noPool) || !Number.isFinite(totalPool) ||
                        yesPool <= 0 || noPool <= 0 || totalPool <= 0) {
                        console.error(`⚠️ Invalid pool values for quick play ${marketData.title}, skipping`);
                        continue;
                    }
                    
                    await marketRef.set({
                        id: marketRef.id,
                        title: marketData.title || "Quick Play Market",
                        category: marketData.category || "General",
                        duration: marketData.duration || "24h",
                        createdByDisplayName: 'PredoraOracle',
                        createdAt: now,
                        resolutionDate: futureDate.toISOString().split('T')[0],
                        isResolved: false,
                        status: 'active',
                        yesPool: yesPool,
                        noPool: noPool,
                        yesPercent: 50,
                        noPercent: 50,
                        totalPool: totalPool,
                        totalStakeVolume: totalPool,
                        marketType: 'binary',
                        isMock: false
                    });
                    console.log(`✅ Created quick play (BINARY): ${marketData.title}`);
                }
            } catch (marketError) {
                console.error(`⚠️ Failed to create quick play: ${marketError.message}`);
            }
        }
    } catch (error) {
        console.error("ORACLE: Failed to create quick plays:", error.message);
    }
}

app.post('/api/run-jobs', async (req, res) => {
    const { key } = req.body;
    if (!CRON_SECRET || key !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        await autoResolveMarkets();
        await autoResolveQuickPolls();
        await createDailyMarkets();
        await autoGenerateQuickPlays();
        res.status(200).json({ success: true });
    } catch (e) {
        console.error("ORACLE: Job failed", e);
        res.status(500).json({ error: "Job failed" });
    }
});

// --- HELPER FUNCTIONS ---
function getMockPrice(asset) { return asset === 'BNB' ? 500 : asset === 'CAKE' ? 3.5 : 1; }
function getBalanceField(asset) { return asset === 'BNB' ? 'bnbBalance' : asset === 'CAKE' ? 'cakeBalance' : 'balance'; }
function generateJuryCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// =============================================================================
// AUTHENTICATION ENDPOINTS (Email/OTP Login System)
// =============================================================================

app.post('/api/auth/send-otp', requireFirebase, async (req, res) => {
    let { email } = req.body;
    
    if (!email) {
        console.warn('⚠️ Send OTP request missing email');
        return res.status(400).json({ error: 'Email required' });
    }
    
    // Normalize email to lowercase to avoid case-sensitivity issues
    email = email.toLowerCase().trim();
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        console.warn(`⚠️ Invalid email format: ${email}`);
        return res.status(400).json({ error: 'Invalid email format' });
    }
    
    try {
        console.log(`📧 Processing send OTP request for: ${email}`);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        const otpRef = db.collection(`artifacts/${APP_ID}/public/data/otp_codes`).doc(email);
        
        console.log(`💾 Saving OTP to database: ${email} -> ${otp}`);
        
        // Always save to memory backup first (instant, no quota issues)
        otpMemoryStore.set(email, {
            otp,
            email,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            used: false
        });
        console.log(`✅ OTP saved to memory backup`);
        
        // Also try to save to Firestore (may fail if quota exceeded)
        try {
            await otpRef.set({
                otp,
                email,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                used: false
            });
            console.log(`✅ OTP saved to database`);
        } catch (dbError) {
            console.warn(`⚠️ Firestore save failed (using memory backup): ${dbError.message}`);
        }
        
        try {
            const sendGridClient = await getUncachableSendGridClient();
            if (sendGridClient) {
                const response = await sendGridClient.client.send({
                    to: email,
                    from: sendGridClient.fromEmail,
                    subject: 'Your Predora Login Code',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                            <h2>Welcome to Predora</h2>
                            <p>Your one-time login code is:</p>
                            <div style="font-size: 32px; font-weight: bold; color: #38BDF8; letter-spacing: 4px; margin: 20px 0;">
                                ${otp}
                            </div>
                            <p>This code expires in 10 minutes.</p>
                        </div>
                    `
                });
                console.log(`✉️ OTP email sent successfully to ${email}. Response:`, response);
            } else {
                console.warn('⚠️ SendGrid not available, OTP not sent via email');
            }
        } catch (emailError) {
            console.error('❌ Email sending FAILED:', emailError.message);
            console.error('Full error:', emailError);
            console.error('Error response:', emailError.response?.body);
        }
        
        console.log(`✅ OTP request completed for ${email}: ${otp}`);
        res.status(200).json({ success: true, message: 'OTP sent to email', expiresIn: 600 });
        
    } catch (error) {
        console.error('❌ Error sending OTP:', error.message, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/verify-otp', requireFirebase, async (req, res) => {
    let { email, otp } = req.body;
    
    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP required' });
    }
    
    // Normalize email to lowercase to match how it was stored
    email = email.toLowerCase().trim();
    
    try {
        let otpData = null;
        let usingMemoryBackup = false;
        
        // Try memory backup first (faster, no quota issues)
        if (otpMemoryStore.has(email)) {
            otpData = otpMemoryStore.get(email);
            usingMemoryBackup = true;
            console.log(`✅ Found OTP in memory backup for ${email}`);
        } else {
            // Fall back to Firestore
            try {
                const otpRef = db.collection(`artifacts/${APP_ID}/public/data/otp_codes`).doc(email);
                const otpSnap = await otpRef.get();
                if (otpSnap.exists) {
                    otpData = otpSnap.data();
                    console.log(`✅ Found OTP in Firestore for ${email}`);
                }
            } catch (dbError) {
                console.warn(`⚠️ Firestore read failed: ${dbError.message}`);
            }
        }
        
        if (!otpData) {
            console.warn(`⚠️ No OTP record found for email: ${email}`);
            return res.status(404).json({ error: 'No code found for this email. Please request a new code.' });
        }
        
        if (otpData.used) {
            console.warn(`⚠️ OTP already used for email: ${email}`);
            return res.status(400).json({ error: 'Code already used' });
        }
        
        if (new Date() > new Date(otpData.expiresAt)) {
            console.warn(`⚠️ OTP expired for email: ${email}`);
            return res.status(400).json({ error: 'Code expired' });
        }
        
        // Normalize both strings for comparison (trim whitespace)
        const storedOtp = String(otpData.otp).trim();
        const providedOtp = String(otp).trim();
        
        console.log(`🔐 OTP Verification (${usingMemoryBackup ? 'MEMORY' : 'FIRESTORE'}):`);
        console.log(`   Email: ${email}`);
        console.log(`   Stored: "${storedOtp}", Provided: "${providedOtp}", Match: ${storedOtp === providedOtp}`);
        
        if (storedOtp !== providedOtp) {
            console.warn(`❌ OTP mismatch for ${email}`);
            return res.status(401).json({ error: 'Invalid code' });
        }
        
        // Mark as used in memory
        if (usingMemoryBackup) {
            otpData.used = true;
            otpMemoryStore.set(email, otpData);
        }
        
        // Try to mark as used in Firestore (may fail, that's ok)
        try {
            const otpRef = db.collection(`artifacts/${APP_ID}/public/data/otp_codes`).doc(email);
            await otpRef.update({ used: true, usedAt: new Date() });
        } catch (dbError) {
            console.warn(`⚠️ Firestore update failed (OTP still valid): ${dbError.message}`);
        }
        
        // Try to create/update user profile (may fail if quota exceeded, that's ok)
        try {
            const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(email);
            const userSnap = await userRef.get();
            
            if (!userSnap.exists) {
                await userRef.set({
                    userId: email,
                    email,
                    createdAt: new Date(),
                    lastLogin: new Date(),
                    xp: 0,
                    displayName: email.split('@')[0],
                    avatarUrl: `https://ui-avatars.com/api/?name=${email.split('@')[0]}&background=random`,
                    following: [],
                    followers: [],
                    badges: []
                });
            } else {
                await userRef.update({ lastLogin: new Date() });
            }
        } catch (profileError) {
            console.warn(`⚠️ User profile update skipped (quota): ${profileError.message}`);
            // Continue anyway - user can still login
        }
        
        const customToken = await admin.auth().createCustomToken(email);
        
        console.log(`✅ OTP verified for ${email}`);
        res.status(200).json({ success: true, token: customToken, message: 'Authentication successful' });
        
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/signup', requireFirebase, async (req, res) => {
    const { email, name } = req.body;
    
    if (!email || !name) {
        return res.status(400).json({ error: 'Email and name required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate name length
    if (name.length < 2 || name.length > 50) {
        return res.status(400).json({ error: 'Name must be between 2 and 50 characters' });
    }
    
    try {
        const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(email);
        const userSnap = await userRef.get();
        
        if (userSnap.exists) {
            return res.status(400).json({ error: 'Account already exists. Please log in.' });
        }
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        await db.collection(`artifacts/${APP_ID}/public/data/otp_codes`).doc(email).set({
            otp,
            email,
            name,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            used: false
        });
        
        try {
            const sendGridClient = await getUncachableSendGridClient();
            if (sendGridClient) {
                await sendGridClient.client.send({
                    to: email,
                    from: sendGridClient.fromEmail,
                    subject: 'Welcome to Predora - Verify Your Email',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                            <h2>Welcome to Predora, ${name}!</h2>
                            <p>Your verification code is:</p>
                            <div style="font-size: 32px; font-weight: bold; color: #38BDF8; letter-spacing: 4px; margin: 20px 0;">
                                ${otp}
                            </div>
                            <p>This code expires in 10 minutes.</p>
                        </div>
                    `
                });
                console.log(`📝 Signup email sent successfully to ${email}`);
            } else {
                console.warn('⚠️ SendGrid not available for signup email');
            }
        } catch (emailError) {
            console.warn('Email sending failed:', emailError.message);
        }
        
        console.log(`📝 New signup: ${email} (${name}) - OTP: ${otp}`);
        res.status(200).json({ success: true, message: 'Account created. Check your email for verification code.', expiresIn: 600 });
        
    } catch (error) {
        console.error('Error in signup:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update user profile (display name, avatar, etc.)
app.post('/api/user/update-profile', requireFirebase, async (req, res) => {
    const { userId, displayName, avatarColor } = req.body;
    
    if (!userId || !displayName) {
        return res.status(400).json({ error: 'userId and displayName required' });
    }
    
    if (displayName.length < 2 || displayName.length > 30) {
        return res.status(400).json({ error: 'Display name must be 2-30 characters' });
    }
    
    try {
        const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(userId);
        
        const updateData = {
            displayName,
            lastUpdated: new Date()
        };
        
        // If avatarColor is provided, generate avatar URL based on color
        if (avatarColor) {
            updateData.avatarColor = avatarColor;
        }
        
        await userRef.set(updateData, { merge: true });
        
        console.log(`👤 Profile updated for ${userId}: ${displayName}`);
        res.status(200).json({ success: true, message: 'Profile updated' });
        
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/demo-login', async (req, res) => {
    const { userId, userName } = req.body;
    
    if (!userId || !userName) {
        return res.status(400).json({ error: 'userId and userName required' });
    }
    
    try {
        const demoDocs = {
            'alice-456': 'alice-456',
            'bob-789': 'bob-789',
            'judge-123': 'judge-123'
        };
        
        const demoUserId = demoDocs[userId.toLowerCase()];
        if (!demoUserId) {
            return res.status(400).json({ error: 'Invalid demo user' });
        }
        
        // Try to update database if available
        if (db) {
            try {
                const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(demoUserId);
                const userSnap = await userRef.get();
                
                if (!userSnap.exists) {
                    await userRef.set({
                        id: demoUserId,
                        displayName: userName,
                        isDemo: true,
                        createdAt: new Date(),
                        lastLogin: new Date(),
                        xp: 1000,
                        balance: 5000,
                        avatarUrl: `https://ui-avatars.com/api/?name=${userName}&background=random`,
                        following: [],
                        followers: [],
                        badges: ['Demo User']
                    });
                } else {
                    await userRef.update({ lastLogin: new Date() });
                }
            } catch (dbError) {
                console.warn('Database update failed (non-critical):', dbError.message);
            }
        }
        
        // Create custom token for Firebase Auth
        let customToken;
        try {
            customToken = await admin.auth().createCustomToken(demoUserId);
        } catch (firebaseError) {
            // If Firebase Admin SDK isn't initialized, create a demo token
            console.warn('Firebase Admin not available, using demo token:', firebaseError.message);
            // Create a simple JWT-like demo token for demo mode
            customToken = Buffer.from(JSON.stringify({
                uid: demoUserId,
                id: demoUserId,
                displayName: userName,
                isDemo: true,
                iat: Math.floor(Date.now() / 1000)
            })).toString('base64');
        }
        
        console.log(`🎮 Demo login: ${userName} (${demoUserId})`);
        res.status(200).json({ success: true, token: customToken, message: `Welcome ${userName}!` });
        
    } catch (error) {
        console.error('Error in demo login:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// DISPUTE & JURY SYSTEM ENDPOINTS
// =============================================================================

app.post('/api/dispute-market', requireAuth, requireFirebase, async (req, res) => {
    const { marketId, marketTitle } = req.body;
    
    try {
        const marketRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId);
        const marketSnap = await marketRef.get();
        
        if (!marketSnap.exists) {
            return res.status(404).json({ error: 'Market not found' });
        }
        
        const marketData = marketSnap.data();
        const now = new Date();
        const windowEnd = new Date(marketData.disputeWindowEndsAt);
        
        if (now > windowEnd) {
            return res.status(400).json({ error: 'Dispute window has closed' });
        }
        
        if (marketData.status === 'disputed') {
            return res.status(400).json({ error: 'Market already disputed' });
        }
        
        await marketRef.update({
            status: 'disputed',
            disputedAt: now,
            disputedBy: req.user.uid,
            canBeDisputed: false
        });
        
        const leaderboardRef = db.collection(`artifacts/${APP_ID}/public/data/public_leaderboard`);
        const snapshot = await leaderboardRef.orderBy('xp', 'desc').limit(10).get();
        
        if (snapshot.empty) {
            await marketRef.update({ status: marketData.status || null });
            return res.status(404).json({ error: 'No leaderboard users found' });
        }
        
        // Fisher-Yates shuffle algorithm (proper random selection)
        const docs = snapshot.docs;
        for (let i = docs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [docs[i], docs[j]] = [docs[j], docs[i]];
        }
        const selected = docs.slice(0, Math.min(5, docs.length));
        
        const selectedJurors = [];
        const expiryTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        for (const doc of selected) {
            const jurorData = doc.data();
            const code = generateJuryCode();
            
            await db.collection(`artifacts/${APP_ID}/public/data/jury_codes`).doc(code).set({
                code,
                userId: doc.id,
                marketId,
                marketTitle,
                createdAt: new Date(),
                expiresAt: expiryTime,
                used: false,
                usedAt: null
            });
            
            const juryLink = `${process.env.REPLIT_DEV_DOMAIN || 'http://localhost:5000'}/app.html?jury=${code}`;
            
            await db.collection(`artifacts/${APP_ID}/public/data/notifications`).add({
                userId: doc.id,
                type: 'jury_invite',
                marketId,
                marketTitle,
                juryCode: code,
                juryLink,
                message: `You've been selected as a juror for: "${marketTitle}". Vote here: ${juryLink}`,
                createdAt: new Date(),
                read: false,
                expiresAt: expiryTime
            });
            
            selectedJurors.push({
                userId: doc.id,
                displayName: jurorData.displayName || 'Anonymous',
                xp: jurorData.xp,
                code
            });
        }
        
        console.log(`⚖️ Market ${marketId} disputed. ${selected.length} jurors selected.`);
        res.status(200).json({
            success: true,
            jurors: selectedJurors,
            message: `Market disputed! ${selected.length} jurors notified.`,
            juryDeadline: expiryTime
        });
        
    } catch (error) {
        console.error('Error disputing market:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/verify-jury-code', requireAuth, requireFirebase, async (req, res) => {
    const { code } = req.body;
    
    try {
        const userId = req.user.uid;
        
        const codeRef = db.collection(`artifacts/${APP_ID}/public/data/jury_codes`).doc(code);
        const codeSnap = await codeRef.get();
        
        if (!codeSnap.exists) {
            return res.status(404).json({ error: 'Invalid code', valid: false });
        }
        
        const codeData = codeSnap.data();
        
        if (codeData.used) {
            return res.status(400).json({ error: 'Code already used', valid: false });
        }
        
        if (new Date(codeData.expiresAt) < new Date()) {
            return res.status(400).json({ error: 'Code expired', valid: false });
        }
        
        if (codeData.userId !== userId) {
            return res.status(403).json({ error: 'Code not assigned to you', valid: false });
        }
        
        res.status(200).json({
            valid: true,
            marketId: codeData.marketId,
            marketTitle: codeData.marketTitle
        });
        
    } catch (error) {
        res.status(401).json({ error: 'Authentication failed', valid: false });
    }
});

app.post('/api/submit-jury-vote', requireAuth, requireFirebase, async (req, res) => {
    const { code, vote } = req.body;
    const userId = req.user.uid;
    
    try {
        if (!vote || (vote !== 'YES' && vote !== 'NO')) {
            return res.status(400).json({ error: 'Invalid vote. Must be YES or NO' });
        }
        
        const codeRef = db.collection(`artifacts/${APP_ID}/public/data/jury_codes`).doc(code);
        const codeSnap = await codeRef.get();
        
        if (!codeSnap.exists) {
            return res.status(404).json({ error: 'Invalid jury code' });
        }
        
        const codeData = codeSnap.data();
        
        if (codeData.used) {
            return res.status(400).json({ error: 'Code already used' });
        }
        
        if (new Date(codeData.expiresAt) < new Date()) {
            return res.status(400).json({ error: 'Code expired' });
        }
        
        if (codeData.userId !== userId) {
            return res.status(403).json({ error: 'Code not assigned to you' });
        }
        
        const marketRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(codeData.marketId);
        
        await db.collection(`artifacts/${APP_ID}/public/data/jury_votes`).add({
            code,
            userId,
            marketId: codeData.marketId,
            vote,
            timestamp: new Date(),
            jurorName: codeData.userId
        });
        
        await codeRef.update({ used: true, usedAt: new Date() });
        
        const voteSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/jury_votes`)
            .where('marketId', '==', codeData.marketId)
            .get();
        
        const votes = voteSnapshot.docs.map(d => d.data().vote);
        const yesCount = votes.filter(v => v === 'YES').length;
        const noCount = votes.filter(v => v === 'NO').length;
        
        if (votes.length >= 3 || votes.length === 5) {
            const winner = yesCount > noCount ? 'YES' : noCount > yesCount ? 'NO' : 'TIE';
            
            await marketRef.update({
                status: 'resolved',
                isResolved: true,
                winningOutcome: winner,
                resolutionMethod: 'jury_resolved',
                juroVotesSummary: { YES: yesCount, NO: noCount },
                juryResolvedAt: new Date()
            });
            
            console.log(`⚖️ Market ${codeData.marketId} jury resolved: ${winner} (${yesCount} YES, ${noCount} NO)`);
        }
        
        res.status(200).json({
            success: true,
            message: 'Vote submitted successfully',
            voteCount: votes.length,
            voteTally: { YES: yesCount, NO: noCount }
        });
        
    } catch (error) {
        console.error('Error submitting jury vote:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// SOCIAL FEED ENDPOINTS
// =============================================================================

app.post('/api/social/create-post', requireAuth, requireFirebase, async (req, res) => {
    const { displayName, avatarUrl, content, imageUrl, attachedMarket } = req.body;
    const userId = req.user.uid;
    
    try {
        // Content required check
        if (!content || content.trim().length === 0) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Rate limiting check
        const rateLimitCheck = checkRateLimit(userId, 'post');
        if (!rateLimitCheck.allowed) {
            return res.status(429).json({ error: rateLimitCheck.message });
        }

        // AI GUARDRAILS: Check content safety before creating post
        const preFilter = preFilterContent(content, 500);
        if (preFilter.blocked) {
            await logSafetyEvent(db, APP_ID, {
                userId,
                action: 'content_blocked',
                contentType: 'post',
                reason: preFilter.reason,
                violations: preFilter.violations || ['format'],
                tier: 'RED',
                ip: req.ip
            });
            return res.status(400).json({ 
                error: preFilter.reason,
                blocked: true 
            });
        }

        // Full AI moderation check with error handling (relaxed for better UX)
        let moderationResult;
        try {
            moderationResult = await moderateContent(content, 'post', geminiClient);
            
            // Log the moderation event
            await logSafetyEvent(db, APP_ID, {
                userId,
                action: 'post_moderated',
                contentType: 'post',
                result: moderationResult,
                ip: req.ip
            });

            // Only block if BOTH confidence is low AND approved is false
            // This prevents false positives where AI says "approved" but confidence is mid-range
            if (moderationResult.confidence < 70 && moderationResult.approved === false) {
                return res.status(400).json({ 
                    error: 'Your post contains potentially inappropriate content.',
                    blocked: true,
                    reason: moderationResult.reason
                });
            }
        } catch (moderationError) {
            console.warn('⚠️ AI moderation failed, falling back to prefilter-only:', moderationError.message);
            // If AI moderation fails, we already passed prefilter, so allow with default score
            moderationResult = { confidence: 75, reason: 'AI moderation unavailable' };
        }

        // Create the post
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`);
        
        const newPost = await postRef.add({
            userId,
            displayName,
            avatarUrl,
            content,
            imageUrl: imageUrl || null,
            attachedMarket: attachedMarket || null,
            reactions: { like: [], heart: [], fire: [], rocket: [] },
            commentCount: 0,
            timestamp: new Date(),
            edited: false,
            editedAt: null,
            isFlexPost: false,
            flexData: null,
            moderationScore: moderationResult.confidence
        });
        
        // 📢 SEND NOTIFICATIONS to all followers of the post creator
        try {
            const userProfileRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(userId);
            const userProfileSnap = await userProfileRef.get();
            const followerIds = userProfileSnap.data()?.followers || [];
            
            // Validate and filter followerIds
            const validFollowerIds = Array.isArray(followerIds) 
                ? followerIds.filter(id => id && typeof id === 'string')
                : [];
            
            if (validFollowerIds.length > 0) {
                const batch = db.batch();
                const truncatedContent = content.substring(0, 50) + (content.length > 50 ? '...' : '');
                
                for (const followerId of validFollowerIds) {
                    const notificationsRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile/${followerId}/notifications`).doc();
                    batch.set(notificationsRef, {
                        type: 'new_post',
                        postId: newPost.id,
                        posterName: displayName,
                        posterAvatarUrl: avatarUrl,
                        message: `${displayName} posted: ${truncatedContent}`,
                        actionUrl: `screen:social-feed:${newPost.id}`,
                        timestamp: new Date(),
                        read: false
                    });
                }
                
                await batch.commit();
                console.log(`📢 New post notifications committed to ${validFollowerIds.length} followers of ${displayName}`);
                
                // Send email notifications asynchronously
                sendNewPostEmails(validFollowerIds, displayName, truncatedContent).catch(err => {
                    console.warn(`⚠️ Email notification async error:`, err.message);
                });
            }
        } catch (notifError) {
            console.error(`⚠️ Failed to send new post notifications:`, notifError.message);
        }
        
        res.status(200).json({ success: true, postId: newPost.id });
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/react', requireAuth, requireFirebase, async (req, res) => {
    const { postId, reaction } = req.body;
    const userId = req.user.uid;
    
    try {
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        const postData = postSnap.data();
        const reactions = postData.reactions || { like: [], heart: [], fire: [], rocket: [] };
        
        // Toggle: remove if present, add if not present
        const index = reactions[reaction].indexOf(userId);
        if (index > -1) {
            // User already reacted, so remove the reaction
            reactions[reaction].splice(index, 1);
        } else {
            // User hasn't reacted, so add the reaction
            reactions[reaction].push(userId);
        }
        
        await postRef.update({ reactions });
        res.status(200).json({ success: true, added: index === -1 });
    } catch (error) {
        console.error('Error toggling reaction:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/comment', requireAuth, requireFirebase, async (req, res) => {
    const { postId, userId, displayName, avatarUrl, content, parentCommentId } = req.body;
    const storedUserId = userId || req.user.uid;
    
    try {
        // Run guardrails on comment content
        const preFilter = preFilterContent(content, 500);
        if (preFilter.blocked) {
            await logSafetyEvent(db, APP_ID, {
                userId: storedUserId,
                action: 'content_blocked',
                contentType: 'comment',
                reason: preFilter.reason,
                violations: ['format'],
                tier: 'RED',
                ip: req.ip
            });
            return res.status(400).json({ error: preFilter.reason, blocked: true });
        }
        
        const blocklist = checkBlocklist(content);
        if (blocklist.blocked) {
            await logSafetyEvent(db, APP_ID, {
                userId: storedUserId,
                action: 'content_blocked',
                contentType: 'comment',
                reason: blocklist.reason,
                violations: [blocklist.category],
                tier: 'RED',
                ip: req.ip
            });
            return res.status(400).json({ error: blocklist.reason, blocked: true });
        }
        
        // Rate limit per user
        const rateLimit = checkRateLimit(storedUserId, req.ip, 'comment');
        if (!rateLimit.allowed) {
            return res.status(429).json({ error: rateLimit.reason, rateLimited: true });
        }
        
        const commentRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts/${postId}/comments`);
        
        const commentData = {
            userId: storedUserId,
            displayName,
            avatarUrl,
            content,
            timestamp: new Date()
        };
        
        if (parentCommentId) {
            commentData.parentCommentId = parentCommentId;
        }
        
        await commentRef.add(commentData);
        
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        const currentCount = postSnap.data().commentCount || 0;
        await postRef.update({ commentCount: currentCount + 1 });
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/delete-post', requireAuth, requireFirebase, async (req, res) => {
    const { postId, userId: forceUserId } = req.body;
    const userId = req.user.uid;
    const userEmail = req.user.email;
    
    console.log('🗑️ Delete request - postId:', postId, 'userId:', userId, 'forceUserId:', forceUserId);
    try {
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        
        if (!postSnap.exists) {
            console.log('❌ Post not found:', postId);
            return res.status(404).json({ error: 'Post not found' });
        }
        
        const postData = postSnap.data();
        console.log('Post found - postUserId:', postData.userId, 'postUserEmail:', postData.userEmail, 'currentUserId:', userId, 'forceUserId:', forceUserId);
        
        // Check authorization: match by userId first, then by forceUserId (for older posts without userId)
        const isAuthorized = (postData.userId?.toLowerCase() === userId?.toLowerCase()) ||
                           (forceUserId && postData.userId?.toLowerCase() === forceUserId?.toLowerCase()) ||
                           (postData.userEmail?.toLowerCase() === userEmail?.toLowerCase());
        
        if (!isAuthorized) {
            console.log('❌ Authorization failed');
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        await postRef.delete();
        console.log('✅ Post deleted successfully');
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ Error deleting post:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/edit-post', requireAuth, requireFirebase, async (req, res) => {
    const { postId, content, userId: forceUserId } = req.body;
    const userId = req.user.uid;
    const userEmail = req.user.email;
    
    try {
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        const postData = postSnap.data();
        // Check authorization: match by userId first, then by forceUserId (for older posts without userId)
        const isAuthorized = (postData.userId?.toLowerCase() === userId?.toLowerCase()) ||
                           (forceUserId && postData.userId?.toLowerCase() === forceUserId?.toLowerCase()) ||
                           (postData.userEmail?.toLowerCase() === userEmail?.toLowerCase());
        
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        await postRef.update({ content: content.trim(), editedAt: new Date() });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error editing post:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/delete-comment', requireAuth, requireFirebase, async (req, res) => {
    const { postId, commentId, userId } = req.body;
    
    try {
        const commentRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts/${postId}/comments`).doc(commentId);
        const commentSnap = await commentRef.get();
        
        if (!commentSnap.exists) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        
        if (commentSnap.data().userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        await commentRef.delete();
        
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        const currentCount = postSnap.data().commentCount || 0;
        await postRef.update({ commentCount: Math.max(0, currentCount - 1) });
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/edit-comment', requireAuth, requireFirebase, async (req, res) => {
    const { postId, commentId, userId, content } = req.body;
    
    try {
        const commentRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts/${postId}/comments`).doc(commentId);
        const commentSnap = await commentRef.get();
        
        if (!commentSnap.exists) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        
        if (commentSnap.data().userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        await commentRef.update({ content: content.trim(), editedAt: new Date() });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error editing comment:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// AI GUARDRAILS ENDPOINTS
// =============================================================================

// Enhanced moderation with full guardrails
app.post('/api/moderate-content', requireAuth, requireFirebase, async (req, res) => {
    const { content, contentType } = req.body;
    const userId = req.user.uid;
    
    if (!content) {
        return res.status(400).json({ error: 'Content required' });
    }
    
    try {
        // Check rate limit
        const rateLimit = checkRateLimit(userId, req.ip, 'moderate');
        if (!rateLimit.allowed) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                retryAfter: rateLimit.retryAfter
            });
        }
        
        // Run full moderation pipeline
        const result = await moderateContent(content, contentType, geminiClient);
        
        // Log the event
        await logSafetyEvent(db, APP_ID, {
            userId,
            action: 'content_moderated',
            contentType,
            result,
            ip: req.ip
        });
        
        res.status(200).json(result);
        
    } catch (error) {
        console.error('Error in moderation:', error);
        res.status(200).json({
            approved: true,
            confidence: 0.5,
            reason: 'Moderation service error (approved with caution)',
            violations: [],
            tier: 'YELLOW'
        });
    }
});

// Report unsafe content
app.post('/api/report-content', requireAuth, requireFirebase, async (req, res) => {
    const { contentId, contentType, reason, details } = req.body;
    const userId = req.user.uid;
    
    try {
        const reportRef = await db.collection(`artifacts/${APP_ID}/public/data/safety_reports`).add({
            reporterId: userId,
            contentId,
            contentType,
            reason,
            details,
            status: 'pending',
            createdAt: new Date(),
            reviewedAt: null,
            reviewedBy: null,
            action: null
        });
        
        console.log(`🚨 Safety report: ${reportRef.id} - ${reason}`);
        
        res.status(200).json({
            success: true,
            reportId: reportRef.id,
            message: 'Report submitted. Our safety team will review it.'
        });
        
    } catch (error) {
        console.error('Error reporting content:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get safety reports (Admin)
app.get('/api/admin/safety-reports', requireAdmin, requireFirebase, async (req, res) => {
    try {
        const reportsRef = db.collection(`artifacts/${APP_ID}/public/data/safety_reports`);
        const snapshot = await reportsRef.where('status', '==', 'pending').get();
        
        const reports = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            reports.push({
                id: doc.id,
                ...data
            });
        }
        
        // Sort by createdAt in descending order (in code to avoid composite index)
        reports.sort((a, b) => {
            const timeA = a.createdAt?.toDate?.() || new Date(a.createdAt);
            const timeB = b.createdAt?.toDate?.() || new Date(b.createdAt);
            return timeB - timeA;
        });
        
        res.status(200).json({ reports, count: reports.length });
        
    } catch (error) {
        console.error('Error fetching safety reports:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin action on report
app.post('/api/admin/safety-action', requireAdmin, requireFirebase, async (req, res) => {
    const { reportId, action, reason } = req.body;
    
    try {
        const reportRef = db.collection(`artifacts/${APP_ID}/public/data/safety_reports`).doc(reportId);
        const reportSnap = await reportRef.get();
        
        if (!reportSnap.exists) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const reportData = reportSnap.data();
        
        await reportRef.update({
            status: 'resolved',
            action,
            adminReason: reason,
            reviewedAt: new Date(),
            reviewedBy: req.user.uid
        });
        
        // Log the admin action
        await logSafetyEvent(db, APP_ID, {
            userId: req.user.uid,
            action: 'safety_action',
            reportId,
            decision: action,
            reason,
            targetContent: reportData.contentId
        });
        
        console.log(`⚖️ Admin action: ${reportId} - ${action}`);
        
        res.status(200).json({ success: true, action });
        
    } catch (error) {
        console.error('Error taking safety action:', error);
        res.status(500).json({ error: error.message });
    }
});

// Safety statistics (Admin)
app.get('/api/admin/safety-stats', requireAdmin, requireFirebase, async (req, res) => {
    try {
        const reportsRef = db.collection(`artifacts/${APP_ID}/public/data/safety_reports`);
        const logsRef = db.collection(`artifacts/${APP_ID}/public/data/safety_logs`);
        
        const pendingSnapshot = await reportsRef.where('status', '==', 'pending').count().get();
        const resolvedSnapshot = await reportsRef.where('status', '==', 'resolved').count().get();
        
        const logsSnapshot = await logsRef.get();
        let safeCount = 0;
        let blockedCount = 0;
        const byReason = {};
        
        logsSnapshot.forEach(doc => {
            const data = doc.data();
            
            // Count blocked content
            if (data.action === 'content_blocked') {
                blockedCount++;
                const tier = data.tier || 'RED';
                byReason[tier] = (byReason[tier] || 0) + 1;
            }
            
            // Count moderated content (both safe and blocked via Gemini)
            if (data.action === 'content_moderated' && data.result) {
                const tier = data.result.tier || 'UNKNOWN';
                byReason[tier] = (byReason[tier] || 0) + 1;
                if (tier === 'GREEN') {
                    safeCount++;
                } else if (tier === 'RED') {
                    blockedCount++;
                }
            }
        });
        
        const stats = {
            safe: safeCount,
            blocked: blockedCount,
            pending: pendingSnapshot.data().count,
            resolved: resolvedSnapshot.data().count,
            reports: pendingSnapshot.data().count,
            moderationStats: byReason,
            totalReports: pendingSnapshot.data().count + resolvedSnapshot.data().count,
            timestamp: new Date().toISOString()
        };
        
        res.status(200).json(stats);
        
    } catch (error) {
        console.error('Error fetching safety stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

// Admin password validation endpoint
app.post('/api/admin/validate-password', (req, res) => {
    const { password } = req.body;
    
    console.log(`🔐 Admin password validation attempt`);
    console.log(`   Provided password length: ${password ? password.length : 'null'}`);
    console.log(`   Stored ADMIN_SECRET exists: ${ADMIN_SECRET ? 'yes' : 'no'}`);
    console.log(`   Stored ADMIN_SECRET length: ${ADMIN_SECRET ? ADMIN_SECRET.length : 'N/A'}`);
    
    if (!ADMIN_SECRET) {
        console.error('❌ ADMIN_SECRET not configured');
        return res.status(503).json({ error: 'Admin system not configured' });
    }
    
    // Trim whitespace from both sides
    const trimmedPassword = (password || '').trim();
    const trimmedSecret = (ADMIN_SECRET || '').trim();
    
    console.log(`   After trim - Provided: "${trimmedPassword}" (${trimmedPassword.length} chars)`);
    console.log(`   After trim - Secret: "${trimmedSecret.substring(0, 3)}***" (${trimmedSecret.length} chars)`);
    console.log(`   Match: ${trimmedPassword === trimmedSecret}`);
    
    if (trimmedPassword === trimmedSecret) {
        console.log(`✅ Admin password validated successfully`);
        res.json({ 
            success: true, 
            adminSecret: ADMIN_SECRET,
            message: 'Admin authentication successful' 
        });
    } else {
        console.error(`❌ Admin password mismatch - rejecting`);
        res.status(401).json({ error: 'Invalid admin password' });
    }
});

app.post('/api/admin/resolve-market', requireAdmin, requireFirebase, async (req, res) => {
    
    const { marketId, outcome } = req.body;
    
    try {
        const marketRef = db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).doc(marketId);
        
        await marketRef.update({
            isResolved: true,
            winningOutcome: outcome,
            resolutionMethod: 'admin_manual',
            resolvedAt: new Date(),
            status: 'resolved'
        });
        
        console.log(`🛡️ Admin resolved market ${marketId} as ${outcome}`);
        res.status(200).json({ success: true, message: 'Market resolved by admin' });
        
    } catch (error) {
        console.error('Error in admin resolve:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/stats', requireAdmin, requireFirebase, async (req, res) => {
    
    try {
        const marketsSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/standard_markets`).get();
        const pledgesSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/pledges`).get();
        const usersSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/user_profile`).get();
        
        const stats = {
            totalMarkets: marketsSnapshot.size,
            resolvedMarkets: marketsSnapshot.docs.filter(d => d.data().isResolved).length,
            totalPledges: pledgesSnapshot.size,
            totalUsers: usersSnapshot.size,
            timestamp: new Date().toISOString()
        };
        
        res.status(200).json(stats);
        
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/disputed-markets', requireAdmin, requireFirebase, async (req, res) => {
    
    try {
        const snapshot = await db.collection(`artifacts/${APP_ID}/public/data/standard_markets`)
            .where('status', '==', 'disputed')
            .get();
        
        const markets = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        res.status(200).json({ markets });
    } catch (error) {
        console.error('Error fetching disputed markets:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clear all data endpoint
app.post('/api/admin/clear-all-data', requireAdmin, requireFirebase, async (req, res) => {
    try {
        const collections = [
            'standard_markets', 'quick_play_markets', 'pledges', 'leaderboard',
            'public_leaderboard', 'user_profile', 'social_posts', 'jury_codes',
            'jury_votes', 'notifications', 'otp_codes', 'market_comments',
            'stake_logs', 'safety_reports', 'flagged_content', 'safety_logs'
        ];
        
        let totalDeleted = 0;
        
        for (const collectionName of collections) {
            const collectionRef = db.collection(`artifacts/${APP_ID}/public/data/${collectionName}`);
            const snapshot = await collectionRef.get();
            
            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            
            if (snapshot.docs.length > 0) {
                await batch.commit();
                totalDeleted += snapshot.docs.length;
                console.log(`🗑️ Cleared ${snapshot.docs.length} documents from ${collectionName}`);
            }
        }
        
        console.log(`✅ All data cleared: ${totalDeleted} total documents deleted`);
        res.status(200).json({ 
            success: true, 
            message: 'All data has been cleared',
            totalDeleted
        });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// NOTIFICATION HELPER FUNCTIONS
// =============================================================================

// Helper function to send market resolution emails
async function sendMarketResolutionEmails(userIds, marketTitle, outcome) {
    try {
        const sendGridClient = await getUncachableSendGridClient();
        if (!sendGridClient) {
            console.warn('⚠️ SendGrid not available, skipping email notifications');
            return;
        }
        
        for (const userId of userIds) {
            try {
                const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(userId);
                const userSnap = await userRef.get();
                const userData = userSnap.data();
                
                if (userData?.email) {
                    await sendGridClient.client.send({
                        to: userData.email,
                        from: sendGridClient.fromEmail,
                        subject: `Market Resolved: "${marketTitle}"`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2>Market Resolution Notification</h2>
                                <p>The market "<strong>${marketTitle}</strong>" has been resolved.</p>
                                <p><strong>Outcome: ${outcome}</strong></p>
                                <p>Click the link below to see the details and claim your winnings:</p>
                                <a href="https://predora.replit.dev?action=market-detail&id=${encodeURIComponent(marketTitle)}" 
                                   style="background-color: #38BDF8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                                    View Market Details
                                </a>
                                <p style="margin-top: 20px; color: #666; font-size: 12px;">This is an automated notification from Predora.</p>
                            </div>
                        `
                    });
                    console.log(`✉️ Market resolution email sent to ${userData.email}`);
                }
            } catch (userError) {
                console.warn(`⚠️ Failed to send email to user ${userId}:`, userError.message);
            }
        }
    } catch (error) {
        console.error(`⚠️ Market resolution email batch error:`, error.message);
    }
}

// Helper function to send new post notification emails
async function sendNewPostEmails(followerIds, posterName, postContent) {
    try {
        const sendGridClient = await getUncachableSendGridClient();
        if (!sendGridClient) {
            console.warn('⚠️ SendGrid not available, skipping email notifications');
            return;
        }
        
        for (const followerId of followerIds) {
            try {
                const followerRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(followerId);
                const followerSnap = await followerRef.get();
                const followerData = followerSnap.data();
                
                if (followerData?.email) {
                    await sendGridClient.client.send({
                        to: followerData.email,
                        from: sendGridClient.fromEmail,
                        subject: `${posterName} posted on Predora`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2>${posterName} Posted Something New!</h2>
                                <p><strong>${posterName}</strong> shared a new post:</p>
                                <p style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; margin: 10px 0;">
                                    "${postContent}"
                                </p>
                                <a href="https://predora.replit.dev?action=feed" 
                                   style="background-color: #38BDF8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                                    View Feed
                                </a>
                                <p style="margin-top: 20px; color: #666; font-size: 12px;">This is an automated notification from Predora.</p>
                            </div>
                        `
                    });
                    console.log(`✉️ New post email sent to ${followerData.email}`);
                }
            } catch (followerError) {
                console.warn(`⚠️ Failed to send email to follower ${followerId}:`, followerError.message);
            }
        }
    } catch (error) {
        console.error(`⚠️ New post email batch error:`, error.message);
    }
}

// =============================================================================
// NOTIFICATION MANAGEMENT ENDPOINTS
// =============================================================================

app.get('/api/notifications', requireAuth, requireFirebase, async (req, res) => {
    const userId = req.user.uid;
    
    try {
        const notificationsRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile/${userId}/notifications`);
        const notificationsSnap = await notificationsRef.orderBy('timestamp', 'desc').get();
        
        const notifications = notificationsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        res.status(200).json({ notifications });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/notifications/mark-read', requireAuth, requireFirebase, async (req, res) => {
    const { notificationIds } = req.body;
    const userId = req.user.uid;
    
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
        return res.status(400).json({ error: 'notificationIds array required' });
    }
    
    try {
        const batch = db.batch();
        
        for (const notificationId of notificationIds) {
            const notifRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile/${userId}/notifications`).doc(notificationId);
            batch.update(notifRef, { read: true, readAt: new Date() });
        }
        
        await batch.commit();
        res.status(200).json({ success: true, marked: notificationIds.length });
    } catch (error) {
        console.error('Error marking notifications as read:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/notifications/:id', requireAuth, requireFirebase, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.uid;
    
    try {
        const notifRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile/${userId}/notifications`).doc(id);
        await notifRef.delete();
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// AI ASSISTANT ENDPOINT - DISABLED (Not shipping in this version)
// =============================================================================
// To re-enable: Uncomment the code below
/*
app.post('/api/ai/chat', async (req, res) => {
    const { messages, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array required' });
    }

    if (!geminiClient) {
        return res.status(503).json({ error: 'AI service not available' });
    }

    try {
        const model = geminiClient.getGenerativeModel({ 
            model: 'gemini-2.0-flash',
            systemInstruction: systemPrompt || `You are an expert AI assistant for Predora, a Gen-Z prediction market platform. You help users understand and navigate the platform.

ABOUT PREDORA:
- Users create and trade on prediction markets about future events
- Markets Types: Standard (long-term), Quick Play (24-48 hours), Binary (YES/NO), Multi-Option (3-6 outcomes)
- Users stake money on market outcomes and earn rewards for accurate predictions
- Uses an Automated Market Maker (AMM) with liquidity pools for market odds

KEY FEATURES:
1. Market Creation & Trading: Create custom markets, stake on outcomes, view pool liquidity and odds
2. Social Feed: Post updates, react to posts, comment, follow other users
3. Leaderboard: Compete with other users, track rankings based on prediction accuracy
4. Jury System: If a market is disputed within 30 minutes of resolution, top 5 leaderboard users vote to resolve
5. AI-Powered Resolution: Markets auto-resolve with Swarm-Verify Oracle (4 AI agents with consensus)
6. Profile Management: Edit username, upload profile pictures, track personal stats
7. Content Moderation: AI guardrails ensure safe community interactions
8. Quick Play Markets: Fast 24-48 hour markets for quick prediction opportunities
9. Profile Viewing: Follow users, view their activity, and see their prediction history

USER EXPERIENCE:
- Earn tokens/rewards for accurate predictions
- Build reputation through the leaderboard
- Participate in the community via social feed
- Dispute market outcomes if you disagree with resolution
- Earn more by predicting trending events early

TRADING MECHANICS:
- Predict YES or NO on binary markets
- Stakes directly affect pool liquidity and odds
- More liquidity = more stable odds
- Higher confidence markets have better potential rewards
- Can withdraw stakes before market resolution

Always be helpful, accurate about platform features, and encourage users to explore markets strategically. If unsure about specific features, acknowledge limitations and suggest checking the app directly.`
        });
        
        // Format messages for Gemini API
        const conversationHistory = messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));
        
        const chat = model.startChat({
            history: conversationHistory.slice(0, -1), // All but the last message
            generationConfig: {
                maxOutputTokens: 1024,
                temperature: 0.7,
            }
        });
        
        // Get the last user message
        const lastUserMessage = conversationHistory[conversationHistory.length - 1];
        const result = await chat.sendMessage(lastUserMessage.parts[0].text);
        const aiMessage = result.response.text();

        res.status(200).json({
            success: true,
            message: aiMessage,
            usage: {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            }
        });

    } catch (error) {
        console.error('Error in AI chat:', error);
        const errorMessage = error.message?.includes('API_KEY_INVALID') || error.message?.includes('API key')
            ? 'AI service authentication failed. Please check your Gemini API key.' 
            : 'Failed to process chat message. Please try again.';
        res.status(error.status || 500).json({ error: errorMessage });
    }
});
*/

// =============================================================================
// ADMIN: REPAIR MARKETS ENDPOINT
// =============================================================================
app.post('/api/admin/repair-markets', requireAdmin, requireFirebase, async (req, res) => {
    try {
        console.log('🔧 Admin triggered market repair...');
        await cleanupBrokenMarkets();
        res.json({ 
            success: true, 
            message: 'Market repair completed. Check server logs for details.' 
        });
    } catch (error) {
        console.error('❌ Market repair failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// HEALTH CHECK
// =============================================================================
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        features: {
            guardRails: !!geminiClient,
            firebase: !!db,
            sendGrid: !!process.env.REPLIT_CONNECTORS_HOSTNAME
        }
    });
});

// =============================================================================
// CLEANUP BROKEN MARKETS (runs once on startup)
// =============================================================================
async function cleanupBrokenMarkets() {
    console.log('🧹 Cleaning up and repairing markets with invalid liquidity...');
    try {
        // Repair standard markets with 0 or invalid pools
        const standardSnapshot = await db.collection(`artifacts/${APP_ID}/public/data/standard_markets`)
            .where('isResolved', '==', false).get();
        let standardRepaired = 0;
        let standardDeleted = 0;
        let multiOptionFixed = 0;
        
        for (const doc of standardSnapshot.docs) {
            const market = doc.data();
            const yesPool = market.yesPool ?? 0;
            const noPool = market.noPool ?? 0;
            const totalPool = market.totalPool ?? 0;
            
            // Fix multi-option markets that incorrectly have yesPercent/noPercent
            if (market.marketType === 'multi' && (market.yesPercent !== undefined || market.noPercent !== undefined)) {
                const updateData = {
                    marketStructure: 'multi-option'
                };
                // Remove yesPercent, noPercent, yesPool, noPool from multi-option markets
                await doc.ref.update({
                    ...updateData,
                    yesPercent: admin.firestore.FieldValue.delete(),
                    noPercent: admin.firestore.FieldValue.delete(),
                    yesPool: admin.firestore.FieldValue.delete(),
                    noPool: admin.firestore.FieldValue.delete()
                });
                multiOptionFixed++;
                console.log(`🔧 Fixed multi-option market (removed yesPercent/noPercent): ${market.title}`);
                continue; // Skip to next market
            }
            
            // Check if pools are invalid (0, NaN, undefined, or Infinity)
            const hasInvalidPools = !Number.isFinite(yesPool) || !Number.isFinite(noPool) || 
                                    !Number.isFinite(totalPool) || yesPool <= 0 || noPool <= 0 || totalPool <= 0;
            
            if (hasInvalidPools) {
                // Repair by calculating actual stake totals from pledges
                const pledgesRef = db.collection(`artifacts/${APP_ID}/public/data/pledges`);
                const pledgeSnaps = await pledgesRef.where('marketId', '==', doc.id).get();
                
                if (pledgeSnaps.empty) {
                    // No stakes yet - safe to repair with default liquidity
                    await doc.ref.update({
                        yesPool: 10000,
                        noPool: 10000,
                        totalPool: 20000,
                        yesPercent: 50,
                        noPercent: 50,
                        totalYesStake: 10000,
                        totalNoStake: 10000,
                        totalStakeVolume: 20000
                    });
                    standardRepaired++;
                    console.log(`🔧 Repaired empty market: ${market.title} (ID: ${doc.id})`);
                } else {
                    // Has stakes - recalculate totals from pledges
                    let totalYesStake = 0;
                    let totalNoStake = 0;
                    
                    pledgeSnaps.docs.forEach(pledgeDoc => {
                        const pledge = pledgeDoc.data();
                        const amountUsd = pledge.amountUsd || 0;
                        if (pledge.pick === 'YES') {
                            totalYesStake += amountUsd;
                        } else if (pledge.pick === 'NO') {
                            totalNoStake += amountUsd;
                        }
                    });
                    
                    // Ensure non-zero totals for percentage calculation
                    if (totalYesStake === 0 && totalNoStake === 0) {
                        totalYesStake = 10000;
                        totalNoStake = 10000;
                    }
                    
                    const totalStaked = totalYesStake + totalNoStake;
                    // Clamp percentages to prevent 0%/100% display issues
                    const yesPercent = Math.max(0.1, Math.min(99.9, (totalYesStake / totalStaked) * 100));
                    const noPercent = Math.max(0.1, Math.min(99.9, (totalNoStake / totalStaked) * 100));
                    
                    await doc.ref.update({
                        yesPool: totalYesStake,
                        noPool: totalNoStake,
                        totalPool: totalStaked,
                        yesPercent: yesPercent,
                        noPercent: noPercent,
                        totalYesStake: totalYesStake,
                        totalNoStake: totalNoStake,
                        totalStakeVolume: totalStaked
                    });
                    standardRepaired++;
                    console.log(`🔧 Repaired market from pledges: ${market.title} (YES: $${totalYesStake.toFixed(2)}, NO: $${totalNoStake.toFixed(2)})`);
                }
            }
        }
        
        // Repair quick play markets
        const quickPlaySnapshot = await db.collection(`artifacts/${APP_ID}/public/data/quick_play_markets`)
            .where('isResolved', '==', false).get();
        let quickPlayRepaired = 0;
        let quickPlayDeleted = 0;
        
        for (const doc of quickPlaySnapshot.docs) {
            const market = doc.data();
            const yesPool = market.yesPool ?? 0;
            const noPool = market.noPool ?? 0;
            const totalPool = market.totalPool ?? 0;
            
            // Fix multi-option quick plays that incorrectly have yesPercent/noPercent
            if (market.marketType === 'multi' && (market.yesPercent !== undefined || market.noPercent !== undefined)) {
                const updateData = {
                    marketStructure: 'multi-option'
                };
                await doc.ref.update({
                    ...updateData,
                    yesPercent: admin.firestore.FieldValue.delete(),
                    noPercent: admin.firestore.FieldValue.delete(),
                    yesPool: admin.firestore.FieldValue.delete(),
                    noPool: admin.firestore.FieldValue.delete()
                });
                multiOptionFixed++;
                console.log(`🔧 Fixed multi-option quick play (removed yesPercent/noPercent): ${market.title}`);
                continue; // Skip to next market
            }
            
            const hasInvalidPools = !Number.isFinite(yesPool) || !Number.isFinite(noPool) || 
                                    !Number.isFinite(totalPool) || yesPool <= 0 || noPool <= 0 || totalPool <= 0;
            
            if (hasInvalidPools) {
                const pledgesRef = db.collection(`artifacts/${APP_ID}/public/data/pledges`);
                const pledgeSnaps = await pledgesRef.where('marketId', '==', doc.id).get();
                
                if (pledgeSnaps.empty) {
                    await doc.ref.update({
                        yesPool: 10000,
                        noPool: 10000,
                        totalPool: 20000,
                        yesPercent: 50,
                        noPercent: 50,
                        totalYesStake: 10000,
                        totalNoStake: 10000,
                        totalStakeVolume: 20000
                    });
                    quickPlayRepaired++;
                    console.log(`🔧 Repaired empty quick play: ${market.title} (ID: ${doc.id})`);
                } else {
                    // Has stakes - recalculate totals from pledges
                    let totalYesStake = 0;
                    let totalNoStake = 0;
                    
                    pledgeSnaps.docs.forEach(pledgeDoc => {
                        const pledge = pledgeDoc.data();
                        const amountUsd = pledge.amountUsd || 0;
                        if (pledge.pick === 'YES') {
                            totalYesStake += amountUsd;
                        } else if (pledge.pick === 'NO') {
                            totalNoStake += amountUsd;
                        }
                    });
                    
                    // Ensure non-zero totals for percentage calculation
                    if (totalYesStake === 0 && totalNoStake === 0) {
                        totalYesStake = 10000;
                        totalNoStake = 10000;
                    }
                    
                    const totalStaked = totalYesStake + totalNoStake;
                    // Clamp percentages to prevent 0%/100% display issues
                    const yesPercent = Math.max(0.1, Math.min(99.9, (totalYesStake / totalStaked) * 100));
                    const noPercent = Math.max(0.1, Math.min(99.9, (totalNoStake / totalStaked) * 100));
                    
                    await doc.ref.update({
                        yesPool: totalYesStake,
                        noPool: totalNoStake,
                        totalPool: totalStaked,
                        yesPercent: yesPercent,
                        noPercent: noPercent,
                        totalYesStake: totalYesStake,
                        totalNoStake: totalNoStake,
                        totalStakeVolume: totalStaked
                    });
                    quickPlayRepaired++;
                    console.log(`🔧 Repaired quick play from pledges: ${market.title} (YES: $${totalYesStake.toFixed(2)}, NO: $${totalNoStake.toFixed(2)})`);
                }
            }
        }
        
        if (standardRepaired > 0 || quickPlayRepaired > 0 || multiOptionFixed > 0) {
            console.log(`✅ Cleanup complete: Repaired ${standardRepaired} standard + ${quickPlayRepaired} quick play markets`);
            console.log(`🔧 Fixed ${multiOptionFixed} multi-option markets (removed yesPercent/noPercent)`);
        } else {
            console.log('✅ No broken markets found - all markets have valid liquidity');
        }
    } catch (error) {
        console.warn('⚠️ Cleanup encountered an issue (non-blocking):', error.message);
    }
}

// =============================================================================
// AUTOMATED ORACLE CRON SCHEDULING
// =============================================================================
// Run oracle jobs every 5 minutes to auto-resolve markets and quick polls
cron.schedule('*/5 * * * *', async () => {
    console.log(`\n⏰ [ORACLE CRON] Running scheduled oracle sweep at ${new Date().toISOString()}`);
    try {
        await autoResolveMarkets();
        await autoResolveQuickPolls();
        await createDailyMarkets();
        await autoGenerateQuickPlays();
        console.log('✅ [ORACLE CRON] All oracle jobs completed successfully');
    } catch (error) {
        console.error('❌ [ORACLE CRON] Error running oracle jobs:', error.message);
    }
});

console.log('⏰ Oracle cron scheduler initialized (runs every 5 minutes)');

// Run cleanup once on startup
cleanupBrokenMarkets();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Predora Backend Server is live on port ${PORT}`);
    console.log(`🛡️ AI Guardrails: ${geminiClient ? '✅ ACTIVE' : '⚠️ DISABLED'}`);
    console.log(`🔄 Oracle Auto-Scheduling: ✅ ACTIVE (every 5 minutes)`);
});