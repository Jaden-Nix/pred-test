

// --- ESM Imports ---
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
const APP_ID = 'predora-hackathon';

// OpenAI removed - now using Gemini for all AI features including content moderation

// Initialize Gemini for AI Assistant Chat (free tier)
let geminiClient = null;
if (GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log("✅ Gemini AI initialized successfully for AI Assistant.");
} else {
    console.warn("⚠️ Gemini API key not set. AI Assistant will be disabled.");
}

// SendGrid connector function - gets fresh credentials each time (don't cache)
async function getUncachableSendGridClient() {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY 
      ? 'repl ' + process.env.REPL_IDENTITY 
      : process.env.WEB_REPL_RENEWAL 
      ? 'depl ' + process.env.WEB_REPL_RENEWAL 
      : null;

    if (!xReplitToken) {
      console.warn("⚠️ SendGrid token not found");
      return null;
    }

    const connectionSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data.items?.[0]);

    if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
      console.warn("⚠️ SendGrid not connected properly");
      return null;
    }

    const apiKey = connectionSettings.settings.api_key;
    const fromEmail = connectionSettings.settings.from_email;
    sgMail.setApiKey(apiKey);
    
    return { client: sgMail, fromEmail };
  } catch (error) {
    console.warn("⚠️ SendGrid initialization error:", error.message);
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
    
    if (!authToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email
        };
        next();
    } catch (error) {
        console.error('Auth verification failed:', error);
        return res.status(401).json({ error: 'Invalid authentication token' });
    }
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
    // Redirect root URL directly to the app in guest mode
    res.redirect('/app.html');
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
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
        contents: [{ parts: [{ text: userPrompt }] }]
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

    // USE THE RETRY FUNCTION HERE TOO
    const googleResponse = await fetchWithRetry(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
                contents: [{ parts: [{ text: `Market: "${market.title}"` }] }],
                tools: [{ "google_search": {} }]
            };

            const response = await callGoogleApi(payload);
            const outcome = response.candidates[0].content.parts[0].text.trim().toUpperCase();

            if (outcome === 'YES' || outcome === 'NO') {
                // Payout logic: distribute winnings to correct predictors
                try {
                    const pledgesRef = db.collection(`artifacts/${APP_ID}/public/data/pledges`);
                    const pledgeSnaps = await pledgesRef.where('marketId', '==', marketId).get();
                    
                    let totalWinnings = 0;
                    const winners = [];
                    
                    for (const pledgeSnap of pledgeSnaps.docs) {
                        const pledge = pledgeSnap.data();
                        if (pledge.prediction === outcome) {
                            winners.push(pledge);
                            totalWinnings += pledge.amount || 0;
                        }
                    }
                    
                    if (winners.length > 0 && totalWinnings > 0) {
                        const poolTotal = market.totalPool || (market.yesAmount || 0) + (market.noAmount || 0);
                        const winningsPerUser = poolTotal / winners.length;
                        
                        for (const winner of winners) {
                            const userRef = db.collection(`artifacts/${APP_ID}/public/data/user_profile`).doc(winner.userId);
                            const userSnap = await userRef.get();
                            if (userSnap.exists) {
                                const userData = userSnap.data();
                                await userRef.update({
                                    balance: (userData.balance || 0) + winningsPerUser,
                                    xp: (userData.xp || 0) + 50
                                });
                            }
                        }
                    }
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

// (The rest of your Oracle functions: createDailyMarkets, autoGenerateQuickPlays, etc. go here. 
//  They are safe because they all use 'callGoogleApi', which now has retry logic.)

app.post('/api/run-jobs', async (req, res) => {
    const { key } = req.body;
    if (!CRON_SECRET || key !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        await autoResolveMarkets();
        // await createDailyMarkets(); // Uncomment if you added this back
        // await autoGenerateQuickPlays(); // Uncomment if you added this back
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
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    
    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        const otpRef = db.collection(`artifacts/${APP_ID}/public/data/otp_codes`).doc(email);
        
        await otpRef.set({
            otp,
            email,
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
                console.log(`✉️ OTP email sent successfully to ${email}`);
            } else {
                console.warn('⚠️ SendGrid not available, OTP not sent via email');
            }
        } catch (emailError) {
            console.warn('Email sending failed:', emailError.message);
        }
        
        console.log(`✉️ OTP sent to ${email}: ${otp}`);
        res.status(200).json({ success: true, message: 'OTP sent to email', expiresIn: 600 });
        
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/verify-otp', requireFirebase, async (req, res) => {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP required' });
    }
    
    try {
        const otpRef = db.collection(`artifacts/${APP_ID}/public/data/otp_codes`).doc(email);
        const otpSnap = await otpRef.get();
        
        if (!otpSnap.exists) {
            return res.status(404).json({ error: 'No code found for this email' });
        }
        
        const otpData = otpSnap.data();
        
        if (otpData.used) {
            return res.status(400).json({ error: 'Code already used' });
        }
        
        if (new Date() > new Date(otpData.expiresAt)) {
            return res.status(400).json({ error: 'Code expired' });
        }
        
        if (otpData.otp !== otp) {
            return res.status(401).json({ error: 'Invalid code' });
        }
        
        await otpRef.update({ used: true, usedAt: new Date() });
        
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
            flexData: null
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
    const { postId, displayName, avatarUrl, content } = req.body;
    const userId = req.user.uid;
    
    try {
        const commentRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts/${postId}/comments`);
        
        await commentRef.add({
            userId,
            displayName,
            avatarUrl,
            content,
            timestamp: new Date()
        });
        
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
    const { postId, commentId } = req.body;
    const userId = req.user.uid;
    
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
    const { postId, commentId, content } = req.body;
    const userId = req.user.uid;
    
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
        const byReason = {};
        
        logsSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.action === 'content_moderated' && data.result) {
                const tier = data.result.tier || 'UNKNOWN';
                byReason[tier] = (byReason[tier] || 0) + 1;
            }
        });
        
        const stats = {
            pending: pendingSnapshot.data().count,
            resolved: resolvedSnapshot.data().count,
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
    
    if (!ADMIN_SECRET) {
        return res.status(503).json({ error: 'Admin system not configured' });
    }
    
    if (password === ADMIN_SECRET) {
        res.json({ 
            success: true, 
            adminSecret: ADMIN_SECRET,
            message: 'Admin authentication successful' 
        });
    } else {
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Predora Backend Server is live on port ${PORT}`);
    console.log(`🛡️ AI Guardrails: ${geminiClient ? '✅ ACTIVE' : '⚠️ DISABLED'}`);
});