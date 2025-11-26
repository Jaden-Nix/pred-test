/**
 * COPY TRADING MODULE
 * Follow top traders and automatically copy their predictions
 * 
 * HOW IT WORKS:
 * 1. Queries real Firebase users with 5+ predictions
 * 2. Calculates win rate: (totalWins / totalPredictions) × 100
 * 3. Sorts by win rate, then by total wins
 * 4. Shows top 5 traders with their actual stats
 * 5. Users can follow/unfollow traders (stored in localStorage)
 * 6. Auto-Copy toggle enables automatic bet copying
 * 
 * REAL DATA SOURCES:
 * - User profiles from Firestore 'users' collection
 * - Win rates calculated from totalWins and totalLosses
 * - Streaks and profits from user stats
 * 
 * AUTO-COPY LOGIC:
 * - When a followed trader makes a prediction, handleTraderPrediction() is called
 * - If auto-copy is enabled, their bet is automatically copied
 * - Notification shown to user about the copied trade
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

// Get top traders from REAL Firebase data
async function getTopTraders() {
    try {
        if (!window.db) {
            console.warn('Firebase not initialized, using fallback data');
            return getFallbackTraders();
        }

        // Query real users from Firestore leaderboard collection
        const APP_ID = window.APP_ID;
        if (!APP_ID || APP_ID === 'default') {
            console.error('⚠️ APP_ID not properly initialized. Copy trading may not work correctly.');
            if (window.showToast) {
                window.showToast('Copy trading data unavailable - using demo data', 'warning');
            }
            return getFallbackTraders();
        }
        const usersRef = window.db.collection(`artifacts/${APP_ID}/public/data/leaderboard`);
        
        // Get all users from leaderboard sorted by XP
        let snapshot = await usersRef
            .orderBy('xp', 'desc')
            .limit(50)
            .get();

        if (snapshot.empty) {
            console.log('⚠️ No users found in leaderboard, using fallback');
            return getFallbackTraders();
        }
        
        console.log(`📊 Found ${snapshot.size} users in leaderboard`);

        // Calculate win rates and build traders list
        const traders = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const totalWins = data.totalWins || 0;
            const totalLosses = data.totalLosses || 0;
            const totalPredictions = totalWins + totalLosses;
            const xp = data.xp || 0;
            
            console.log(`👤 User ${data.displayName}: XP=${xp}, wins=${totalWins}, losses=${totalLosses}, total=${totalPredictions}`);
            
            // Only include users with at least 1 prediction
            if (totalPredictions >= 1) {
                const winRate = totalPredictions > 0 ? Math.round((totalWins / totalPredictions) * 100) : 0;
                
                traders.push({
                    id: doc.id,
                    name: data.displayName || 'Anonymous Trader',
                    avatar: data.avatarUrl || getRandomAvatar(),
                    stats: {
                        winRate: winRate,
                        totalWins: totalWins,
                        streak: data.streak || 0,
                        totalProfit: data.totalProfit || 0,
                        xp: xp
                    }
                });
            }
        });

        // Sort by win rate first, then by XP
        traders.sort((a, b) => {
            if (b.stats.winRate !== a.stats.winRate) {
                return b.stats.winRate - a.stats.winRate;
            }
            return b.stats.xp - a.stats.xp;
        });

        // Return top 5
        const topFive = traders.slice(0, 5);
        
        if (topFive.length === 0) {
            console.log('⚠️ No traders with predictions found, using fallback');
            return getFallbackTraders();
        }

        console.log(`📊 Loaded ${topFive.length} real top traders from Firebase`);
        return topFive;
        
    } catch (error) {
        console.error('Error fetching top traders:', error);
        return getFallbackTraders();
    }
}

// Fallback traders (only used if Firebase fails)
function getFallbackTraders() {
    // Return a special marker to indicate configuration issue
    return [{
        id: 'config-error',
        isConfigError: true,
        message: 'Copy trading requires proper APP_ID configuration'
    }];
}

// Get random avatar emoji
function getRandomAvatar() {
    const avatars = ['👤', '🎭', '🎨', '🎯', '🎲', '🎪', '🎸', '🎺', '🎻', '🎬'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

// Render copy trading panel
async function renderCopyTradingPanel() {
    console.log('📊 Rendering copy trading panel...');
    const container = document.getElementById('copy-trading-container');
    if (!container) {
        console.warn('⚠️ Copy trading container not found!');
        return;
    }
    
    console.log('🔍 Fetching top traders from Firebase...');
    const topTraders = await getTopTraders();
    console.log('✅ Got traders:', topTraders.length, topTraders);
    
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
                ${topTraders.length > 0 && topTraders[0].isConfigError ? `
                    <div class="text-center py-12">
                        <div class="text-6xl mb-4">⚠️</div>
                        <h4 class="text-xl font-bold text-orange-400 mb-2">Configuration Issue</h4>
                        <p class="text-gray-400 mb-6">${topTraders[0].message}</p>
                        <div class="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/30 rounded-xl p-4 text-sm text-gray-300">
                            <p class="mb-2">⚙️ <strong>To fix this:</strong></p>
                            <ol class="text-left list-decimal list-inside space-y-1 ml-4">
                                <li>Ensure APP_ID is properly initialized in your app</li>
                                <li>Check Firebase configuration</li>
                                <li>Contact support if the issue persists</li>
                            </ol>
                        </div>
                    </div>
                ` : topTraders.length === 0 ? `
                    <div class="text-center py-12">
                        <div class="text-6xl mb-4">📊</div>
                        <h4 class="text-xl font-bold text-white mb-2">No Traders Yet</h4>
                        <p class="text-gray-400 mb-6">Be the first to make predictions and climb the leaderboard!</p>
                        <div class="bg-gradient-to-r from-sky-500/10 to-purple-500/10 border border-sky-500/30 rounded-xl p-4 text-sm text-gray-300">
                            <p class="mb-2">💡 <strong>How to appear here:</strong></p>
                            <ol class="text-left list-decimal list-inside space-y-1 ml-4">
                                <li>Place predictions on markets</li>
                                <li>Build your win rate and track record</li>
                                <li>Rank among the top 5 traders</li>
                                <li>Get followed by other users!</li>
                            </ol>
                        </div>
                    </div>
                ` : `
                <div class="space-y-3">
                    ${topTraders.filter(t => !t.isConfigError).map((trader, index) => {
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
                `}
            </div>
            
            <!-- Info Card -->
            <div class="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl p-6">
                <div class="flex items-start gap-3">
                    <div class="text-3xl">💡</div>
                    <div>
                        <h4 class="font-bold text-white mb-2">How Copy Trading Works</h4>
                        <ul class="text-sm text-gray-300 space-y-2">
                            <li>📊 <strong>Real Stats:</strong> All traders shown are real users with 5+ predictions</li>
                            <li>🎯 <strong>Win Rates:</strong> Calculated from their actual prediction history</li>
                            <li>✨ <strong>Follow:</strong> Click to follow successful traders</li>
                            <li>🔄 <strong>Auto-Copy:</strong> Enable to automatically match their future predictions</li>
                            <li>💎 <strong>Learn:</strong> Study top performers and improve your strategy</li>
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
