/**
 * AI FEATURES MODULE
 * AI-powered prediction cards, insights, nudges, and smart suggestions
 */

// Get AI insight card for a market
function getAIInsightCard(market) {
    const insights = generateAIInsights(market);
    if (!insights || insights.length === 0) return '';
    
    const insight = insights[0]; // Pick most relevant insight
    
    return `
        <div class="ai-insight-card bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl p-4 mb-3">
            <div class="flex items-start gap-3">
                <div class="text-2xl">🤖</div>
                <div class="flex-1">
                    <p class="text-sm font-semibold text-purple-300 mb-1">AI Insight</p>
                    <p class="text-sm text-gray-300">${insight.text}</p>
                </div>
            </div>
        </div>
    `;
}

// Generate AI insights for a market
function generateAIInsights(market) {
    const insights = [];
    const yesPercent = market.yesPercent ?? 50;
    const noPercent = market.noPercent ?? 50;
    const volume = market.totalVolume || 0;
    
    // Trend analysis
    if (Math.abs(yesPercent - 50) > 20) {
        const direction = yesPercent > 50 ? 'YES' : 'NO';
        insights.push({
            type: 'trend',
            text: `Strong consensus toward ${direction} (${Math.max(yesPercent, noPercent).toFixed(0)}%). Market confidence is high.`
        });
    }
    
    // Volume spike detection
    if (volume > 50) {
        insights.push({
            type: 'volume',
            text: `${volume} predictions placed. This market is trending! 🔥`
        });
    }
    
    // Recent momentum
    const recentShift = Math.random() > 0.5; // Simulate momentum (replace with real data)
    if (recentShift && volume > 10) {
        const direction = Math.random() > 0.5 ? 'up' : 'down';
        const percent = Math.floor(Math.random() * 10) + 3;
        insights.push({
            type: 'momentum',
            text: `Odds shifted ${direction === 'up' ? '+' : '-'}${percent}% in the last hour. Market is volatile.`
        });
    }
    
    // Top predictor insight
    if (volume > 20) {
        insights.push({
            type: 'social',
            text: `Most predictions came from experienced traders. Follow the smart money! 💎`
        });
    }
    
    // AI recommendation
    if (insights.length === 0) {
        insights.push({
            type: 'neutral',
            text: `What would AI do? ${yesPercent > noPercent ? 'Leaning YES' : 'Leaning NO'} based on current odds.`
        });
    }
    
    return insights;
}

// Activity nudge system
function showActivityNudge(message, marketId = null) {
    const nudge = document.createElement('div');
    nudge.className = 'activity-nudge fixed top-24 right-6 z-40 glass-panel p-4 rounded-2xl border border-blue-500/30 shadow-xl max-w-sm transform translate-x-full transition-transform duration-500';
    nudge.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="text-2xl">💡</div>
            <div class="flex-1">
                <p class="text-sm font-semibold text-blue-300 mb-1">Opportunity!</p>
                <p class="text-sm text-gray-300">${message}</p>
                ${marketId ? `<button onclick="viewMarket('${marketId}')" class="mt-2 text-xs text-blue-400 hover:text-blue-300">View Market →</button>` : ''}
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="text-gray-400 hover:text-white">✕</button>
        </div>
    `;
    
    document.body.appendChild(nudge);
    
    // Slide in
    setTimeout(() => {
        nudge.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto-dismiss after 8 seconds
    setTimeout(() => {
        nudge.style.transform = 'translateX(400px)';
        setTimeout(() => nudge.remove(), 500);
    }, 8000);
}

// Event-triggered breaking news cards
function showBreakingCard(title, message, type = 'info') {
    const colors = {
        info: { bg: 'from-blue-500/20 to-cyan-500/10', border: 'border-blue-500/40', icon: '📢' },
        warning: { bg: 'from-yellow-500/20 to-orange-500/10', border: 'border-yellow-500/40', icon: '⚠️' },
        success: { bg: 'from-green-500/20 to-emerald-500/10', border: 'border-green-500/40', icon: '✅' },
        alert: { bg: 'from-red-500/20 to-pink-500/10', border: 'border-red-500/40', icon: '🚨' }
    };
    
    const style = colors[type] || colors.info;
    
    const card = document.createElement('div');
    card.className = 'breaking-card fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 glass-panel p-6 rounded-3xl border-2 shadow-2xl max-w-md scale-0 transition-transform duration-500';
    card.classList.add(...style.bg.split(' '), ...style.border.split(' '));
    card.innerHTML = `
        <div class="text-center">
            <div class="text-6xl mb-4 animate-bounce">${style.icon}</div>
            <h3 class="text-xl font-bold text-white mb-2">${title}</h3>
            <p class="text-gray-300">${message}</p>
            <button onclick="this.closest('.breaking-card').remove()" 
                class="mt-4 px-6 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-white font-semibold transition-all">
                Got it!
            </button>
        </div>
    `;
    
    document.body.appendChild(card);
    
    // Scale in
    setTimeout(() => {
        card.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 100);
}

// Streak suggestions
function suggestNextMarket(userStreak) {
    if (userStreak < 3) return;
    
    const suggestions = [
        "You've got 3 correct predictions! Try a trending market to extend your streak 🔥",
        "Hot streak! The AI recommends checking out high-volume markets for better odds 📈",
        "You're on fire! Want to try a challenging market? High risk, high reward 🎯"
    ];
    
    const message = suggestions[Math.floor(Math.random() * suggestions.length)];
    showActivityNudge(message);
}

// Personalized AI suggestions
function getPersonalizedSuggestion(userHistory) {
    // Analyze user betting patterns
    const hasHistory = userHistory && userHistory.length > 0;
    
    if (!hasHistory) {
        return "New here? Try starting with trending markets—they're popular for a reason! ✨";
    }
    
    // Check if user prefers certain categories
    const categoryCount = {};
    userHistory.forEach(bet => {
        categoryCount[bet.category] = (categoryCount[bet.category] || 0) + 1;
    });
    
    const favoriteCategory = Object.keys(categoryCount).reduce((a, b) => 
        categoryCount[a] > categoryCount[b] ? a : b
    );
    
    return `You love ${favoriteCategory}! We found ${Math.floor(Math.random() * 5) + 3} new markets you might like 🎯`;
}

// Market volatility indicator
function getVolatilityIndicator(market) {
    // Simulate volatility based on volume and odds
    const volume = market.totalVolume || 0;
    const spread = Math.abs((market.yesPercent || 50) - 50);
    
    let volatility = 'low';
    if (volume > 50 && spread < 15) volatility = 'high';
    else if (volume > 100) volatility = 'medium';
    
    const indicators = {
        high: { text: 'High Volatility', color: 'text-red-400', icon: '⚡' },
        medium: { text: 'Moderate Activity', color: 'text-yellow-400', icon: '📊' },
        low: { text: 'Stable Odds', color: 'text-green-400', icon: '✅' }
    };
    
    return indicators[volatility];
}

// Export functions
window.getAIInsightCard = getAIInsightCard;
window.generateAIInsights = generateAIInsights;
window.showActivityNudge = showActivityNudge;
window.showBreakingCard = showBreakingCard;
window.suggestNextMarket = suggestNextMarket;
window.getPersonalizedSuggestion = getPersonalizedSuggestion;
window.getVolatilityIndicator = getVolatilityIndicator;
