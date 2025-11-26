/**
 * COPY TRADING MODULE
 * Follow top traders and automatically copy their predictions
 */

// Copy trading state
let followedTraders = [];
let autoCopyEnabled = false;

// Initialize copy trading
function initCopyTrading() {
    loadFollowedTraders();
    console.log('💎 Copy trading system initialized!');
}

// Load followed traders from localStorage
function loadFollowedTraders() {
    const stored = localStorage.getItem('followedTraders');
    if (stored) {
        try {
            followedTraders = JSON.parse(stored);
        } catch (e) {
            followedTraders = [];
        }
    }
    
    const autoCopy = localStorage.getItem('autoCopyEnabled');
    autoCopyEnabled = autoCopy === 'true';
}

// Save followed traders
function saveFollowedTraders() {
    localStorage.setItem('followedTraders', JSON.stringify(followedTraders));
    localStorage.setItem('autoCopyEnabled', autoCopyEnabled.toString());
}

// Follow a trader
function followTrader(traderId, traderName, traderStats) {
    if (followedTraders.find(t => t.id === traderId)) {
        showToast('Already following this trader!', 'info');
        return;
    }
    
    followedTraders.push({
        id: traderId,
        name: traderName,
        stats: traderStats,
        followedAt: Date.now()
    });
    
    saveFollowedTraders();
    showToast(`Now following ${traderName}! 🎯`, 'success');
    renderCopyTradingPanel();
}

// Unfollow a trader
function unfollowTrader(traderId) {
    followedTraders = followedTraders.filter(t => t.id !== traderId);
    saveFollowedTraders();
    showToast('Trader unfollowed', 'info');
    renderCopyTradingPanel();
}

// Toggle auto-copy
function toggleAutoCopy() {
    autoCopyEnabled = !autoCopyEnabled;
    saveFollowedTraders();
    
    const button = document.getElementById('auto-copy-toggle');
    if (button) {
        button.textContent = autoCopyEnabled ? '✅ Auto-Copy ON' : '⚪ Auto-Copy OFF';
        button.className = autoCopyEnabled 
            ? 'px-4 py-2 rounded-xl bg-green-500/20 text-green-400 font-semibold border-2 border-green-500/50'
            : 'px-4 py-2 rounded-xl bg-gray-500/20 text-gray-400 font-semibold border-2 border-gray-500/50';
    }
    
    showToast(autoCopyEnabled ? 'Auto-copy enabled! 🔥' : 'Auto-copy disabled', 'info');
}

// Get top traders (mock data - replace with real Firestore query)
async function getTopTraders() {
    // In production, query Firestore for users with best win rates
    return [
        {
            id: 'trader1',
            name: 'CryptoKing',
            avatar: '👑',
            stats: {
                winRate: 78,
                totalWins: 156,
                streak: 12,
                totalProfit: 2450
            }
        },
        {
            id: 'trader2',
            name: 'OracleAI',
            avatar: '🤖',
            stats: {
                winRate: 75,
                totalWins: 132,
                streak: 8,
                totalProfit: 1980
            }
        },
        {
            id: 'trader3',
            name: 'MarketMaster',
            avatar: '💎',
            stats: {
                winRate: 72,
                totalWins: 108,
                streak: 15,
                totalProfit: 1650
            }
        },
        {
            id: 'trader4',
            name: 'ProphetPro',
            avatar: '🔮',
            stats: {
                winRate: 69,
                totalWins: 94,
                streak: 6,
                totalProfit: 1420
            }
        },
        {
            id: 'trader5',
            name: 'BullRunner',
            avatar: '🐂',
            stats: {
                winRate: 67,
                totalWins: 87,
                streak: 9,
                totalProfit: 1230
            }
        }
    ];
}

// Render copy trading panel
async function renderCopyTradingPanel() {
    const container = document.getElementById('copy-trading-container');
    if (!container) return;
    
    const topTraders = await getTopTraders();
    
    container.innerHTML = `
        <div class="space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                        💎 Copy Trading
                    </h2>
                    <p class="text-sm text-gray-400 mt-1">Follow top traders and copy their predictions automatically</p>
                </div>
                <button id="auto-copy-toggle" onclick="toggleAutoCopy()" 
                    class="${autoCopyEnabled ? 'px-4 py-2 rounded-xl bg-green-500/20 text-green-400 font-semibold border-2 border-green-500/50' : 'px-4 py-2 rounded-xl bg-gray-500/20 text-gray-400 font-semibold border-2 border-gray-500/50'}">
                    ${autoCopyEnabled ? '✅ Auto-Copy ON' : '⚪ Auto-Copy OFF'}
                </button>
            </div>
            
            <!-- Following Section -->
            ${followedTraders.length > 0 ? `
                <div class="ui-panel p-6 rounded-2xl">
                    <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <span class="live-user-dot"></span>
                        Following (${followedTraders.length})
                    </h3>
                    <div class="space-y-3">
                        ${followedTraders.map(trader => `
                            <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                                <div class="flex items-center gap-3">
                                    <div class="w-12 h-12 bg-gradient-to-br from-sky-400 to-indigo-500 rounded-full flex items-center justify-center text-2xl">
                                        ${trader.stats?.avatar || '👤'}
                                    </div>
                                    <div>
                                        <p class="font-bold text-white">${trader.name}</p>
                                        <div class="flex gap-3 text-xs text-gray-400 mt-1">
                                            <span class="text-green-400">${trader.stats?.winRate || 0}% win rate</span>
                                            <span>${trader.stats?.totalWins || 0} wins</span>
                                        </div>
                                    </div>
                                </div>
                                <button onclick="unfollowTrader('${trader.id}')" 
                                    class="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold transition-all">
                                    Unfollow
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <!-- Top Traders -->
            <div class="ui-panel p-6 rounded-2xl">
                <h3 class="text-lg font-bold text-white mb-4">🏆 Top Traders</h3>
                <div class="space-y-3">
                    ${topTraders.map((trader, index) => {
                        const isFollowing = followedTraders.find(t => t.id === trader.id);
                        const rank = index + 1;
                        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
                        
                        return `
                            <div class="trader-card flex items-center justify-between p-4 rounded-xl ${rank <= 3 ? 'bg-gradient-to-r from-yellow-500/10 to-orange-500/5 border border-yellow-500/30' : 'bg-white/5'} hover-lift">
                                <div class="flex items-center gap-4">
                                    <div class="text-2xl font-bold">${medal}</div>
                                    <div class="w-14 h-14 bg-gradient-to-br from-sky-400 to-indigo-500 rounded-full flex items-center justify-center text-3xl">
                                        ${trader.avatar}
                                    </div>
                                    <div>
                                        <p class="font-bold text-white text-lg">${trader.name}</p>
                                        <div class="flex gap-4 text-sm mt-1">
                                            <span class="text-green-400 font-semibold">${trader.stats.winRate}% win rate</span>
                                            <span class="text-gray-400">${trader.stats.totalWins} wins</span>
                                            <span class="text-orange-400">🔥 ${trader.stats.streak} streak</span>
                                        </div>
                                        <p class="text-xs text-gray-500 mt-1">Total profit: <span class="text-green-400 font-semibold">+$${trader.stats.totalProfit.toLocaleString()}</span></p>
                                    </div>
                                </div>
                                ${isFollowing ? `
                                    <div class="px-4 py-2 rounded-xl bg-green-500/20 text-green-400 font-semibold flex items-center gap-2">
                                        ✓ Following
                                    </div>
                                ` : `
                                    <button onclick='followTrader("${trader.id}", "${trader.name}", ${JSON.stringify(trader.stats).replace(/'/g, "\\'")})'
                                        class="px-6 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 font-semibold transition-all border border-sky-500/30 hover:border-sky-400/50">
                                        Follow
                                    </button>
                                `}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            
            <!-- Info Card -->
            <div class="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl p-6">
                <div class="flex items-start gap-3">
                    <div class="text-3xl">💡</div>
                    <div>
                        <h4 class="font-bold text-white mb-2">How Copy Trading Works</h4>
                        <ul class="text-sm text-gray-300 space-y-2">
                            <li>✨ Follow successful traders with high win rates</li>
                            <li>🔄 Enable Auto-Copy to automatically match their predictions</li>
                            <li>📊 Track their performance in real-time</li>
                            <li>🎯 Learn from the best and improve your strategy</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Handle trader prediction (for auto-copy)
function handleTraderPrediction(traderId, marketId, prediction) {
    if (!autoCopyEnabled) return;
    
    const isFollowing = followedTraders.find(t => t.id === traderId);
    if (!isFollowing) return;
    
    // Auto-copy the prediction
    console.log(`Auto-copying ${isFollowing.name}'s prediction: ${prediction} on market ${marketId}`);
    
    // Show notification
    showActivityNudge(
        `${isFollowing.name} just predicted ${prediction}! ${autoCopyEnabled ? 'Auto-copying...' : 'Follow to copy?'}`,
        marketId
    );
    
    // Trigger the bet
    if (window.placeBet) {
        window.placeBet(marketId, prediction);
    }
}

// Export functions
window.initCopyTrading = initCopyTrading;
window.followTrader = followTrader;
window.unfollowTrader = unfollowTrader;
window.toggleAutoCopy = toggleAutoCopy;
window.renderCopyTradingPanel = renderCopyTradingPanel;
window.handleTraderPrediction = handleTraderPrediction;
window.getTopTraders = getTopTraders;
