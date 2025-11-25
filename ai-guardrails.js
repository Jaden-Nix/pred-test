// =============================================================================
// AI GUARDRAILS - Content Moderation & Safety System
// =============================================================================

export const SAFETY_CONFIG = {
    autoApproveThreshold: 0.95,
    manualReviewThreshold: 0.70,
    blockThreshold: 0.50,
    
    blockedCategories: [
        'hate',
        'harassment',
        'violence',
        'sexual',
        'illegal'
    ],
    
    rateLimits: {
        marketsPerMinute: 5,
        commentsPerMinute: 30,
        requestsPerHour: 300
    }
};

const KEYWORD_BLOCKLIST = {
    financial: [
        'pump and dump',
        'rug pull',
        'insider trading',
        'market manipulation'
    ],
    hate: [
        'exterminate',
        'inferior',
        'destroy [religion]'
    ],
    violence: [
        'plan to kill',
        'violent attack',
        'bomb threat',
        'assassination'
    ],
    illegal: [
        'heroin',
        'cocaine',
        'counterfeit',
        'stolen goods'
    ],
    spam: [
        'click here',
        'buy now',
        'guaranteed profit',
        'free money'
    ]
};

const rateLimitBuckets = new Map();
const minuteLimits = new Map();

export function preFilterContent(content, maxLength = 2000) {
    if (!content || typeof content !== 'string') {
        return { blocked: true, reason: 'Invalid input' };
    }
    
    if (content.length < 3) {
        return { blocked: true, reason: 'Content too short' };
    }
    
    if (content.length > maxLength) {
        return { blocked: true, reason: `Content too long (max ${maxLength} characters)` };
    }
    
    const profanityList = [
        /hate\s*speech/gi,
        /kill\s*all/gi,
        /terrorist/gi,
        /suicide/gi,
        /bomb/gi
    ];
    
    for (const pattern of profanityList) {
        if (pattern.test(content)) {
            return { blocked: true, reason: 'Contains prohibited content' };
        }
    }
    
    if (/(.)\1{10,}/.test(content)) {
        return { blocked: true, reason: 'Excessive repetition' };
    }
    
    const urlCount = (content.match(/https?:\/\//g) || []).length;
    if (urlCount > 5) {
        return { blocked: true, reason: 'Too many links' };
    }
    
    const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
    if (capsRatio > 0.7 && content.length > 10) {
        return { blocked: true, reason: 'Excessive capitalization' };
    }
    
    return { blocked: false };
}

export function checkBlocklist(content) {
    const lower = content.toLowerCase();
    
    for (const [category, keywords] of Object.entries(KEYWORD_BLOCKLIST)) {
        for (const keyword of keywords) {
            if (lower.includes(keyword.toLowerCase())) {
                return {
                    blocked: true,
                    reason: `Prohibited ${category} content`,
                    category
                };
            }
        }
    }
    
    return { blocked: false };
}

export async function moderateContentWithOpenAI(content, openai) {
    try {
        const response = await openai.moderations.create({
            model: 'text-moderation-latest',
            input: content
        });
        
        const result = response.results[0];
        
        const categories = [];
        let maxScore = 0;
        
        for (const [key, value] of Object.entries(result.category_scores)) {
            if (result.categories[key]) {
                categories.push(key);
            }
            maxScore = Math.max(maxScore, value);
        }
        
        return {
            flagged: result.flagged,
            categories,
            confidence: maxScore,
            scores: result.category_scores
        };
    } catch (error) {
        console.error('Moderation API error:', error);
        return { flagged: false, error: error.message };
    }
}

export async function moderateContent(content, contentType, openai, maxLength = 2000) {
    const preFilter = preFilterContent(content, maxLength);
    if (preFilter.blocked) {
        return {
            approved: false,
            confidence: 1.0,
            reason: preFilter.reason,
            violations: ['format'],
            tier: 'RED'
        };
    }
    
    const blocklist = checkBlocklist(content);
    if (blocklist.blocked) {
        return {
            approved: false,
            confidence: 1.0,
            reason: blocklist.reason,
            violations: [blocklist.category],
            tier: 'RED'
        };
    }
    
    if (!openai) {
        return {
            approved: true,
            confidence: 0.5,
            reason: 'Moderation service unavailable (approved with caution)',
            violations: [],
            tier: 'YELLOW'
        };
    }
    
    const moderation = await moderateContentWithOpenAI(content, openai);
    
    if (moderation.error) {
        return {
            approved: true,
            confidence: 0.5,
            reason: 'Moderation service unavailable (approved with caution)',
            violations: [],
            tier: 'YELLOW'
        };
    }
    
    if (moderation.flagged) {
        return {
            approved: false,
            confidence: 1.0,
            reason: `Content flagged: ${moderation.categories.join(', ')}`,
            violations: moderation.categories,
            tier: 'RED'
        };
    }
    
    return {
        approved: true,
        confidence: Math.max(0.95, 1.0 - (moderation.confidence * 0.1)),
        reason: 'Content approved',
        violations: [],
        tier: 'GREEN'
    };
}

export function initRateLimiter(userId, ipAddress) {
    const key = `${userId}:${ipAddress}`;
    
    if (!rateLimitBuckets.has(key)) {
        rateLimitBuckets.set(key, {
            tokens: 100,
            lastRefill: Date.now(),
            requests: []
        });
    }
}

export function checkRateLimit(userId, ipAddress, action = 'default') {
    const key = `${userId}:${ipAddress}`;
    initRateLimiter(userId, ipAddress);
    
    const bucket = rateLimitBuckets.get(key);
    const now = Date.now();
    
    const timePassed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(100, bucket.tokens + timePassed);
    bucket.lastRefill = now;
    
    const costs = {
        'market_create': 10,
        'comment': 2,
        'vote': 1,
        'share': 1,
        'default': 5
    };
    
    const cost = costs[action] || costs.default;
    
    if (bucket.tokens >= cost) {
        bucket.tokens -= cost;
        bucket.requests.push({ action, timestamp: now });
        return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }
    
    return { 
        allowed: false, 
        remaining: Math.floor(bucket.tokens),
        retryAfter: Math.ceil((cost - bucket.tokens))
    };
}

export function checkMinuteLimit(userId, action) {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    if (!minuteLimits.has(key)) {
        minuteLimits.set(key, []);
    }
    
    const requests = minuteLimits.get(key);
    const recentRequests = requests.filter(ts => ts > oneMinuteAgo);
    minuteLimits.set(key, recentRequests);
    
    const limits = {
        'market_create': 5,
        'comment': 30,
        'vote': 60
    };
    
    const limit = limits[action] || 10;
    
    if (recentRequests.length >= limit) {
        return {
            allowed: false,
            count: recentRequests.length,
            limit,
            reason: `Exceeded ${action} limit (${limit}/min)`
        };
    }
    
    recentRequests.push(now);
    minuteLimits.set(key, recentRequests);
    
    return { allowed: true, count: recentRequests.length, limit };
}

export async function logSafetyEvent(db, APP_ID, event) {
    try {
        await db.collection(`artifacts/${APP_ID}/public/data/safety_logs`).add({
            ...event,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Error logging safety event:', error);
    }
}

export function createRateLimitMiddleware(openai, db, APP_ID) {
    return async (req, res, next) => {
        try {
            const userId = req.user?.uid || req.ip;
            const action = req.body.action || 'default';
            
            const minuteCheck = checkMinuteLimit(userId, action);
            if (!minuteCheck.allowed) {
                return res.status(429).json({
                    error: minuteCheck.reason,
                    limit: minuteCheck.limit,
                    count: minuteCheck.count
                });
            }
            
            next();
        } catch (error) {
            console.error('Rate limit middleware error:', error);
            next();
        }
    };
}
