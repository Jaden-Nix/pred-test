import fetch from 'node-fetch';

// Configuration
const CONFIG = {
    HIGH_CONFIDENCE_THRESHOLD: 90,
    MID_CONFIDENCE_THRESHOLD: 85,
    LOW_CONFIDENCE_THRESHOLD: 50,
    
    AGENT_TIMEOUT_MS: 12000,
    MAX_RETRIES: 2,
    PARALLEL_MODE: true,
    
    GEOMETRIC_MEDIAN_MAX_ITERATIONS: 100,
    GEOMETRIC_MEDIAN_TOLERANCE: 1e-6,
    
    SECOND_PASS_ENABLED: true,
    SECOND_PASS_TEMPERATURE: 0.1,
    
    MULTI_MODEL_SCORING_ENABLED: true,
    SCORING_WEIGHTS: {
        factual: 0.45,
        consistency: 0.25,
        timestamp: 0.20,
        sentiment: 0.10
    },
    USE_BLENDED_SCORE: true
};

// Helper: Extract regex pattern from text
function extractPattern(text, regex, fallback = '') {
    const match = text.match(regex);
    return match ? match[1] : fallback;
}

// Helper: Extract sources from text
function extractSources(text) {
    if (!text) return [];
    const urlRegex = /https?:\/\/[^\s)]+/g;
    return (text.match(urlRegex) || []).slice(0, 3);
}

// Helper: Sanitize market data to prevent prompt injection
function sanitizeMarketData(market) {
    const truncate = (str, len = 500) => typeof str === 'string' ? str.slice(0, len).replace(/"/g, '\\"') : '';
    return {
        title: truncate(market.title, 200),
        description: truncate(market.description, 300),
        category: truncate(market.category, 50),
        resolutionDate: market.resolutionDate || new Date().toISOString()
    };
}

// Helper: Count keywords in text
function countKeywords(text, keywords) {
    return keywords.reduce((count, word) => {
        const matches = text.match(new RegExp(`\\b${word}\\b`, 'gi'));
        return count + (matches ? matches.length : 0);
    }, 0);
}

// Timeout wrapper
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Agent timeout')), ms))
    ]);
}

// Helper: Call Gemini API with GoogleGenerativeAI client
async function callGemini(geminiClient, prompt, systemPrompt = '') {
    try {
        if (!geminiClient) throw new Error('Gemini client not available');
        const model = geminiClient.getGenerativeModel({ model: 'gemini-1.5-pro' });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            systemInstruction: systemPrompt,
            generationConfig: {
                maxOutputTokens: 1024,
                temperature: 0.3,
            }
        });
        return result.response.text();
    } catch (error) {
        throw new Error(`Gemini API call failed: ${error.message}`);
    }
}

// --- AGENTS ---

// Agent 1: Gemini Research Agent
async function gpt4oResearchAgent(market, geminiClient) {
    try {
        const sanitized = sanitizeMarketData(market);
        const systemPrompt = `You are a factual research agent for prediction market resolution.
Your task is to determine if the following market outcome is TRUE or FALSE.

Rules:
1. Use credible reasoning and established facts
2. If evidence is inconclusive or contradictory, return AMBIGUOUS
3. Provide confidence score (0-100) based on evidence quality
4. Be thorough but concise

Output format:
OUTCOME: YES|NO|AMBIGUOUS
CONFIDENCE: <0-100>
RATIONALE: <detailed explanation>
SOURCES: <any relevant URLs or references>`;

        const userPrompt = `Market Title: "${sanitized.title}"
Description: "${sanitized.description}"
Resolution Date: ${sanitized.resolutionDate}
Category: ${sanitized.category}

Determine the outcome with maximum accuracy.`;

        const content = await callGemini(geminiClient, userPrompt, systemPrompt);
        const outcome = extractPattern(content, /OUTCOME:\s*(YES|NO|AMBIGUOUS)/i, 'AMBIGUOUS').toUpperCase();
        const confidence = parseInt(extractPattern(content, /CONFIDENCE:\s*(\d+)/i)) || 65;
        const rationale = extractPattern(content, /RATIONALE:\s*(.+?)(?=SOURCES:|$)/is, '');
        const sources = extractSources(extractPattern(content, /SOURCES:\s*(.+?)$/is, ''));

        return {
            agent: 'gpt4o-research',
            outcome,
            confidence: Math.max(0, Math.min(100, confidence)),
            rationale,
            sources,
            rawResponse: content,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.warn('Gemini Research Agent failed:', error.message);
        return {
            agent: 'gemini-research',
            outcome: 'AMBIGUOUS',
            confidence: 40,
            rationale: 'Agent failed to process market',
            sources: [],
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// Agent 2: Gemini Skeptic Agent
async function gpt4oMiniSkepticAgent(market, geminiClient, otherAgentResults = []) {
    try {
        const sanitized = sanitizeMarketData(market);
        const systemPrompt = `You are a PARANOID SKEPTIC agent for market resolution.

Your role:
1. ASSUME all claims are false until proven with overwhelming evidence
2. Look for contradictions, biases, and unreliable reasoning
3. Challenge assumptions and question weak evidence
4. Only accept outcomes backed by strong logical proof
5. Default to AMBIGUOUS if ANY doubt exists

Be extremely critical and conservative.`;

        let userPrompt = `Market: "${sanitized.title}"
Description: "${sanitized.description}"
Resolution Date: ${sanitized.resolutionDate}

Critically evaluate this market.`;
        
        if (otherAgentResults.length > 0) {
            userPrompt += `\n\nOTHER AGENTS' FINDINGS (verify these critically):`;
            otherAgentResults.forEach((result, i) => {
                userPrompt += `\nAgent ${i + 1} (${result.agent}):
- Outcome: ${result.outcome}
- Confidence: ${result.confidence}%
- Rationale: ${result.rationale.slice(0, 300)}`;
            });
        }

        const content = await callGemini(geminiClient, userPrompt, systemPrompt);
        const outcome = extractPattern(content, /OUTCOME:\s*(YES|NO|AMBIGUOUS)/i, 'AMBIGUOUS').toUpperCase();
        const confidence = parseInt(extractPattern(content, /CONFIDENCE:\s*(\d+)/i)) || 50;
        const rationale = extractPattern(content, /RATIONALE:\s*(.+?)(?=SOURCES:|$)/is, '');

        return {
            agent: 'gpt4o-mini-skeptic',
            outcome,
            confidence: Math.max(0, Math.min(100, confidence)),
            rationale,
            sources: [],
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.warn('Gemini Skeptic Agent failed:', error.message);
        return {
            agent: 'gemini-skeptic',
            outcome: 'AMBIGUOUS',
            confidence: 45,
            rationale: 'Agent failed to process market',
            sources: [],
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// Agent 3: DuckDuckGo Fact-Checker
async function duckDuckGoAgent(market) {
    try {
        const searchQuery = `${market.title} ${market.category}`;
        
        const response = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json`
        );
        const data = await response.json();

        const abstractText = data.AbstractText || '';
        const content = abstractText.toLowerCase();
        
        const yesKeywords = ['confirmed', 'verified', 'true', 'yes', 'successful', 'achieved', 'passed', 'approved'];
        const noKeywords = ['false', 'denied', 'failed', 'no', 'rejected', 'unsuccessful', 'failed'];
        
        const yesCount = countKeywords(content, yesKeywords);
        const noCount = countKeywords(content, noKeywords);
        
        let outcome = 'AMBIGUOUS';
        let confidence = 45;
        
        if (yesCount > noCount * 1.5) {
            outcome = 'YES';
            confidence = Math.min(65, 45 + yesCount * 4);
        } else if (noCount > yesCount * 1.5) {
            outcome = 'NO';
            confidence = Math.min(65, 45 + noCount * 4);
        }

        return {
            agent: 'duckduckgo',
            outcome,
            confidence: Math.max(0, Math.min(100, confidence)),
            rationale: `Found ${yesCount} positive and ${noCount} negative indicators from search results.`,
            sources: [data.AbstractURL].filter(Boolean),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.warn('DuckDuckGo Agent failed:', error.message);
        return {
            agent: 'duckduckgo',
            outcome: 'AMBIGUOUS',
            confidence: 40,
            rationale: 'Agent failed to fetch search results',
            sources: [],
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// Agent 4: Gemini Investigator (Optional)
async function geminiAgent(market, geminiApiKey, geminiUrl) {
    if (!geminiApiKey) {
        return {
            agent: 'gemini',
            outcome: 'AMBIGUOUS',
            confidence: 0,
            rationale: 'Gemini API key not configured',
            sources: [],
            timestamp: new Date().toISOString(),
            skipped: true
        };
    }

    try {
        const sanitized = sanitizeMarketData(market);
        const payload = {
            systemInstruction: {
                parts: [{ text: 'You are an investigative agent for prediction markets. Determine YES, NO, or AMBIGUOUS.' }]
            },
            contents: [{
                parts: [{ 
                    text: `Market: "${sanitized.title}"\nDescription: "${sanitized.description}"\nDetermine the outcome and provide confidence (0-100).\n\nOutput format:\nOUTCOME: YES|NO|AMBIGUOUS\nCONFIDENCE: <0-100>` 
                }]
            }],
            tools: [{ "google_search": {} }]
        };

        const response = await fetch(`${geminiUrl}?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        const outcome = extractPattern(content, /OUTCOME:\s*(YES|NO|AMBIGUOUS)/i, 'AMBIGUOUS').toUpperCase();
        const confidence = parseInt(extractPattern(content, /CONFIDENCE:\s*(\d+)/i)) || 55;

        return {
            agent: 'gemini',
            outcome,
            confidence: Math.max(0, Math.min(100, confidence)),
            rationale: content.slice(0, 300),
            sources: [],
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.warn('Gemini Agent failed:', error.message);
        return {
            agent: 'gemini',
            outcome: 'AMBIGUOUS',
            confidence: 40,
            rationale: 'Gemini agent failed',
            sources: [],
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// --- CONSENSUS ALGORITHM ---

function computeGeometricMedian(points, maxIterations = CONFIG.GEOMETRIC_MEDIAN_MAX_ITERATIONS, tolerance = CONFIG.GEOMETRIC_MEDIAN_TOLERANCE) {
    if (points.length === 0) return 0;
    if (points.length === 1) return points[0];
    
    const points2D = points.map(p => [p, 0]);
    
    let y = [
        points2D.reduce((sum, p) => sum + p[0], 0) / points2D.length,
        0
    ];
    
    for (let iter = 0; iter < maxIterations; iter++) {
        const distances = points2D.map(p => 
            Math.sqrt((p[0] - y[0]) ** 2 + (p[1] - y[1]) ** 2)
        );
        
        const weights = distances.map(d => 1 / (d + 1e-10));
        const weightSum = weights.reduce((sum, w) => sum + w, 0);
        
        const y_new = [
            weights.reduce((sum, w, i) => sum + w * points2D[i][0], 0) / weightSum,
            0
        ];
        
        const diff = Math.abs(y_new[0] - y[0]);
        if (diff < tolerance) break;
        
        y = y_new;
    }
    
    return Math.max(0, Math.min(100, Math.round(y[0])));
}

function aggregateConsensus(agentResults) {
    const groups = { YES: [], NO: [], AMBIGUOUS: [] };
    agentResults.forEach(r => {
        if (r.skipped) return;
        groups[r.outcome]?.push(r);
    });
    
    const majorityOutcome = Object.keys(groups).reduce((a, b) => 
        groups[a].length > groups[b].length ? a : b
    );
    
    const confidences = groups[majorityOutcome].map(r => r.confidence);
    const consensusConfidence = confidences.length > 0 ? computeGeometricMedian(confidences) : 50;
    
    return {
        outcome: majorityOutcome,
        confidence: consensusConfidence,
        rationale: groups[majorityOutcome]
            .map(r => `[${r.agent}] ${r.rationale.slice(0, 200)}`)
            .join('\n\n'),
        sources: [...new Set(agentResults.flatMap(r => r.sources || []))],
        agentVotes: {
            YES: groups.YES.length,
            NO: groups.NO.length,
            AMBIGUOUS: groups.AMBIGUOUS.length
        }
    };
}

// --- MULTI-MODEL SCORING ---

async function factualScorer(market, consensus, geminiClient) {
    try {
        const prompt = `Verify factual accuracy of this resolution:

Market: "${market.title}"
Consensus: ${consensus.outcome} (${consensus.confidence}% confidence)
Rationale: ${consensus.rationale.slice(0, 300)}

Rate factual accuracy (0-100). Consider:
- Are facts verifiable?
- Is reasoning sound?
- Any factual errors?

Output: SCORE: <0-100>`;

        const content = await callGemini(geminiClient, prompt, 'You are a factual accuracy reviewer. Provide an accuracy score.');
        const scoreMatch = content.match(/SCORE:\s*(\d+)/i);
        return Math.max(0, Math.min(100, parseInt(scoreMatch?.[1] || 75)));
    } catch (error) {
        console.warn('Factual Scorer failed:', error.message);
        return 75;
    }
}

async function consistencyScorer(market, consensus) {
    let score = 100;
    const rationale = consensus.rationale.toLowerCase();
    
    if (consensus.outcome === 'YES') {
        const negativeWords = ['no', 'not', 'false', 'failed', 'unsuccessful', 'rejected'];
        const negCount = negativeWords.reduce((count, word) => 
            count + (rationale.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length, 0);
        score -= negCount * 8;
    } else if (consensus.outcome === 'NO') {
        const positiveWords = ['yes', 'true', 'successful', 'approved', 'confirmed'];
        const posCount = positiveWords.reduce((count, word) => 
            count + (rationale.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length, 0);
        score -= posCount * 8;
    }
    
    if (consensus.agentVotes && consensus.agentVotes[consensus.outcome] > 1) {
        score += 10;
    }
    
    return Math.max(0, Math.min(100, score));
}

async function timestampScorer(market, consensus) {
    const now = new Date();
    const resolutionDate = new Date(market.resolutionDate);
    
    let score = 100;
    
    if (resolutionDate > now) {
        const daysUntil = (resolutionDate - now) / (1000 * 60 * 60 * 24);
        if (daysUntil > 7) score = 30;
        else if (daysUntil > 0) score = 70;
    }
    
    return score;
}

async function sentimentScorer(market, consensus) {
    const rationale = consensus.rationale.toLowerCase();
    
    const biasedWords = ['obviously', 'clearly', 'definitely', 'undoubtedly', 'always', 'never'];
    const biasCount = biasedWords.reduce((count, word) =>
        count + (rationale.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length, 0);
    
    let score = 100 - (biasCount * 15);
    return Math.max(0, score);
}

async function runMultiModelScoring(market, consensus, geminiClient) {
    try {
        const scores = {
            factual: await factualScorer(market, consensus, geminiClient),
            consistency: await consistencyScorer(market, consensus),
            timestamp: await timestampScorer(market, consensus),
            sentiment: await sentimentScorer(market, consensus)
        };

        const blendedScore = 
            scores.factual * CONFIG.SCORING_WEIGHTS.factual +
            scores.consistency * CONFIG.SCORING_WEIGHTS.consistency +
            scores.timestamp * CONFIG.SCORING_WEIGHTS.timestamp +
            scores.sentiment * CONFIG.SCORING_WEIGHTS.sentiment;

        return {
            finalConfidence: Math.round(blendedScore),
            scores,
            originalConfidence: consensus.confidence
        };
    } catch (error) {
        console.warn('Multi-Model Scoring failed:', error.message);
        return {
            finalConfidence: consensus.confidence,
            scores: { factual: 70, consistency: 70, timestamp: 100, sentiment: 100 },
            originalConfidence: consensus.confidence
        };
    }
}

// --- MAIN SWARM RESOLUTION ---

export async function swarmVerifyResolution(market, options = {}, geminiClient = null) {
    try {
        console.log(`🐝 Swarm-Verify starting for market: "${market.title}"`);

        if (!geminiClient) {
            throw new Error('Gemini instance not provided');
        }

        // Phase 1: Run agents in parallel
        console.log('📊 Phase 1: Parallel Agent Research');
        
        const agentTasks = [
            withTimeout(gpt4oResearchAgent(market, geminiClient), CONFIG.AGENT_TIMEOUT_MS),
            withTimeout(gpt4oMiniSkepticAgent(market, geminiClient), CONFIG.AGENT_TIMEOUT_MS),
            withTimeout(duckDuckGoAgent(market), CONFIG.AGENT_TIMEOUT_MS)
        ];

        const agentResults = await Promise.all(agentTasks.map(p => p.catch(e => ({
            agent: 'unknown',
            outcome: 'AMBIGUOUS',
            confidence: 40,
            rationale: 'Agent timeout',
            sources: [],
            timestamp: new Date().toISOString(),
            error: e.message
        }))));

        console.log(`✅ Phase 1 Complete: ${agentResults.length} agents responded`);

        // Phase 2: Skeptic verification
        console.log('🔍 Phase 2: Skeptic Adversarial Verification');
        const nonSkepticResults = agentResults.filter(r => r.agent !== 'gemini-skeptic');
        const skepticResult = await withTimeout(
            gpt4oMiniSkepticAgent(market, geminiClient, nonSkepticResults),
            CONFIG.AGENT_TIMEOUT_MS
        ).catch(e => ({
            agent: 'gemini-skeptic',
            outcome: 'AMBIGUOUS',
            confidence: 45,
            rationale: 'Skeptic agent failed',
            sources: [],
            timestamp: new Date().toISOString()
        }));

        // Phase 3: Geometric median consensus
        console.log('🔗 Phase 3: Geometric Median Consensus');
        const consensusResult = aggregateConsensus(agentResults);
        console.log(`✅ Consensus: ${consensusResult.outcome} (${consensusResult.confidence}% confidence)`);

        // Phase 3.5: Multi-model scoring
        console.log('📈 Phase 3.5: Multi-Model Scoring');
        let finalConfidence = consensusResult.confidence;
        let scoringDetails = {};

        if (CONFIG.MULTI_MODEL_SCORING_ENABLED && geminiClient) {
            try {
                const scoring = await runMultiModelScoring(market, consensusResult, geminiClient);
                finalConfidence = scoring.finalConfidence;
                scoringDetails = scoring.scores;
                console.log(`✅ Multi-Model Score: ${finalConfidence}%`);
            } catch (e) {
                console.warn('Multi-model scoring failed, using consensus confidence');
            }
        }

        // Phase 4: Return final resolution
        console.log(`🎯 Phase 4: Tiered Confidence Routing`);
        
        const resolution = {
            outcome: consensusResult.outcome,
            confidence: finalConfidence,
            rationale: consensusResult.rationale,
            sources: consensusResult.sources,
            agentVotes: consensusResult.agentVotes,
            scoringDetails,
            agents: agentResults.map(r => ({
                agent: r.agent,
                outcome: r.outcome,
                confidence: r.confidence
            })),
            path: finalConfidence >= 90 ? 'auto-resolve' : finalConfidence >= 85 ? 'second-pass' : 'manual-review',
            timestamp: new Date().toISOString()
        };

        console.log(`✅ Swarm-Verify complete: ${resolution.path}`);
        return resolution;

    } catch (error) {
        console.error('❌ Swarm-Verify failed:', error.message);
        throw error;
    }
}

// --- HELPER: Second Pass Review ---
export async function secondPassReview(market, firstResolution, geminiClient = null) {
    try {
        if (!geminiClient) throw new Error('Gemini instance required for second pass');

        console.log(`🔄 Second Pass Review for: "${market.title}"`);
        
        const systemPrompt = `You are a senior market resolution reviewer performing a second-pass verification.

First Pass Results:
- Outcome: ${firstResolution.outcome}
- Confidence: ${firstResolution.confidence}%
- Rationale: ${firstResolution.rationale.slice(0, 300)}

Your task: Independently verify if this outcome is correct. Consider:
1. Are there any contradictions in the evidence?
2. Could the outcome be interpreted differently?
3. Is the confidence level appropriate?

Output format:
OUTCOME: YES|NO|AMBIGUOUS
CONFIDENCE: <0-100>
VERIFICATION: <brief verification>`;

        const sanitized = sanitizeMarketData(market);
        const userPrompt = `Market: "${sanitized.title}"
Description: "${sanitized.description}"

Perform independent verification of the first pass outcome.`;

        const content = await callGemini(geminiClient, userPrompt, systemPrompt);
        const outcome = extractPattern(content, /OUTCOME:\s*(YES|NO|AMBIGUOUS)/i, firstResolution.outcome).toUpperCase();
        const confidence = parseInt(extractPattern(content, /CONFIDENCE:\s*(\d+)/i)) || firstResolution.confidence;

        return {
            outcome,
            confidence: Math.max(0, Math.min(100, confidence)),
            rationale: extractPattern(content, /VERIFICATION:\s*(.+?)$/is, ''),
            isSecondPass: true,
            firstPassConfidence: firstResolution.confidence,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.warn('Second pass review failed:', error.message);
        return {
            outcome: firstResolution.outcome,
            confidence: Math.max(0, firstResolution.confidence - 5),
            rationale: 'Second pass failed',
            isSecondPass: true,
            firstPassConfidence: firstResolution.confidence,
            timestamp: new Date().toISOString()
        };
    }
}

export { CONFIG };
