

// --- ESM Imports ---
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { OpenAI } from 'openai';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';

// --- Constants ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
const APP_ID = 'predora-hackathon';

// Initialize OpenAI for Swarm Agents (conditional - only if keys are available)
let openai = null;
if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1'
    });
    console.log("OpenAI initialized successfully for Swarm Agents.");
} else {
    console.warn("⚠️ OpenAI API key not set. Swarm verification will be disabled. Use Replit AI Integrations to enable.");
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

app.get('/app.html', (req, res) => {
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
    const { postId } = req.body;
    const userId = req.user.uid;
    
    try {
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        if (postSnap.data().userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        await postRef.delete();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/social/edit-post', requireAuth, requireFirebase, async (req, res) => {
    const { postId, content } = req.body;
    const userId = req.user.uid;
    
    try {
        const postRef = db.collection(`artifacts/${APP_ID}/public/data/social_posts`).doc(postId);
        const postSnap = await postRef.get();
        
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        if (postSnap.data().userId !== userId) {
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

app.post('/api/moderate-content', async (req, res) => {
    const { content, contentType } = req.body;
    
    if (!content) {
        return res.status(400).json({ error: 'Content required' });
    }
    
    if (!openai) {
        return res.status(200).json({
            approved: true,
            confidence: 0.5,
            reason: 'Moderation service unavailable (approved with caution)',
            violations: [],
            tier: 'YELLOW'
        });
    }
    
    try {
        const moderation = await openai.moderations.create({
            model: 'text-moderation-latest',
            input: content
        });
        
        const result = moderation.results[0];
        
        if (result.flagged) {
            const categories = Object.keys(result.categories).filter(k => result.categories[k]);
            
            return res.status(200).json({
                approved: false,
                confidence: 1.0,
                reason: `Content flagged: ${categories.join(', ')}`,
                violations: categories,
                tier: 'RED'
            });
        }
        
        res.status(200).json({
            approved: true,
            confidence: 0.95,
            reason: 'Content approved',
            violations: [],
            tier: 'GREEN'
        });
        
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

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Predora Backend Server is live on port ${PORT}`);
});