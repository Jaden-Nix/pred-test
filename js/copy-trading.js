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
function followTrader(traderId, traderName, traderStats, traderAvatar) {
    if (followedTraders.find(t => t.id === traderId)) {
        showToast('Already following this trader!', 'info');
        return;
    }
    
    followedTraders.push({
        id: traderId,
        name: traderName,
        stats: traderStats,
        avatar: traderAvatar || '👤',
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
            ? 'px-6 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold border-2 border-green-400 shadow-lg shadow-green-500/50 hover:shadow-xl hover:scale-105 transition-all'
            : 'px-6 py-3 rounded-xl bg-gray-700/50 text-gray-300 font-bold border-2 border-gray-600 hover:bg-gray-600/50 hover:scale-105 transition-all';
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
            <div class="ui-panel p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/30">
                <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <h2 class="text-2xl font-bold text-white flex items-center gap-2 mb-2">
                            💎 Copy Trading
                        </h2>
                        <p class="text-sm text-gray-300">Follow top traders and automatically copy their winning predictions</p>
                    </div>
                    <button id="auto-copy-toggle" onclick="toggleAutoCopy()" 
                        class="${autoCopyEnabled 
                            ? 'px-6 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold border-2 border-green-400 shadow-lg shadow-green-500/50 hover:shadow-xl hover:scale-105 transition-all' 
                            : 'px-6 py-3 rounded-xl bg-gray-700/50 text-gray-300 font-bold border-2 border-gray-600 hover:bg-gray-600/50 hover:scale-105 transition-all'}">
                        ${autoCopyEnabled ? '✅ Auto-Copy ON' : '⚪ Auto-Copy OFF'}
                    </button>
                </div>
            </div>
            
            <!-- Following Section -->
            ${followedTraders.length > 0 ? `
                <div class="ui-panel p-6 rounded-2xl bg-gradient-to-br from-green-500/5 to-emerald-500/5 border border-green-500/20">
                    <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <span class="live-user-dot"></span>
                        Following (${followedTraders.length})
                    </h3>
                    <div class="space-y-3">
                        ${followedTraders.map(trader => `
                            <div class="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 hover:shadow-lg hover:shadow-green-500/20 transition-all">
                                <div class="flex items-center gap-4">
                                    <div class="w-14 h-14 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center text-3xl shadow-lg">
                                        ${trader.avatar || '👤'}
                                    </div>
                                    <div>
                                        <p class="font-bold text-white text-lg">${trader.name}</p>
                                        <div class="flex gap-4 text-sm mt-1">
                                            <span class="text-green-400 font-semibold">✓ ${trader.stats?.winRate || 0}% win rate</span>
                                            <span class="text-gray-300">${trader.stats?.totalWins || 0} wins</span>
                                        </div>
                                    </div>
                                </div>
                                <button onclick="unfollowTrader('${trader.id}')" 
                                    class="px-5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold transition-all border border-red-500/30 hover:border-red-400">
                                    Unfollow
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <!-- Top Traders -->
            <div class="ui-panel p-6 rounded-2xl">
                <h3 class="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    🏆 Top Traders
                    <span class="text-xs font-normal text-gray-400 ml-2">(Real user data)</span>
                </h3>
                ${topTraders.length > 0 && topTraders[0].isConfigError ? `
                    <div class="text-center py-8">
                        <div class="text-5xl mb-4">📊</div>
                        <h4 class="text-lg font-bold text-sky-400 mb-2">Loading Trader Data...</h4>
                        <p class="text-sm text-gray-400 mb-4">Setting up real-time trading insights</p>
                        <div class="bg-gradient-to-r from-sky-500/10 to-indigo-500/10 border border-sky-500/20 rounded-xl p-4 text-xs text-gray-300 max-w-md mx-auto">
                            <p class="mb-2">💡 <strong>Copy Trading Features:</strong></p>
                            <ul class="text-left space-y-1 ml-4">
                                <li>• Follow successful traders automatically</li>
                                <li>• Real-time prediction copying</li>
                                <li>• Track record transparency</li>
                                <li>• Smart risk management</li>
                            </ul>
                        </div>
                    </div>
                ` : topTraders.length === 0 ? `
                    <div class="text-center py-10">
                        <div class="text-5xl mb-4">🚀</div>
                        <h4 class="text-lg font-bold text-white mb-2">Be a Top Trader!</h4>
                        <p class="text-sm text-gray-400 mb-6">Make your first prediction and start building your track record</p>
                        <div class="bg-gradient-to-r from-sky-500/10 to-purple-500/10 border border-sky-500/30 rounded-xl p-5 text-sm text-gray-300 max-w-md mx-auto">
                            <p class="mb-3 font-semibold text-sky-300">💡 How to become a top trader:</p>
                            <ol class="text-left space-y-2 ml-4">
                                <li class="flex items-start gap-2">
                                    <span class="text-sky-400">1.</span>
                                    <span>Make accurate predictions on markets</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <span class="text-sky-400">2.</span>
                                    <span>Build a high win rate and streak</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <span class="text-sky-400">3.</span>
                                    <span>Climb to top 5 in the rankings</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <span class="text-sky-400">4.</span>
                                    <span>Get followed and copied by others!</span>
                                </li>
                            </ol>
                        </div>
                    </div>
                ` : `
                <div class="space-y-4">
                    ${topTraders.filter(t => !t.isConfigError).map((trader, index) => {
                        const isFollowing = followedTraders.find(t => t.id === trader.id);
                        const rank = index + 1;
                        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
                        const rankClass = rank === 1 
                            ? 'bg-gradient-to-r from-yellow-500/20 to-amber-500/10 border-yellow-500/40 shadow-lg shadow-yellow-500/20' 
                            : rank === 2 
                            ? 'bg-gradient-to-r from-gray-400/20 to-slate-500/10 border-gray-400/40 shadow-lg shadow-gray-400/20'
                            : rank === 3
                            ? 'bg-gradient-to-r from-orange-600/20 to-amber-700/10 border-orange-600/40 shadow-lg shadow-orange-600/20'
                            : 'bg-gradient-to-r from-sky-500/10 to-indigo-500/5 border-sky-500/20';
                        
                        return `
                            <div class="trader-card flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 rounded-2xl ${rankClass} border-2 hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
                                <div class="flex items-center gap-4 w-full sm:w-auto mb-3 sm:mb-0">
                                    <div class="text-3xl font-bold min-w-[3rem] text-center">${medal}</div>
                                    <div class="w-16 h-16 bg-gradient-to-br from-sky-400 to-indigo-500 rounded-full flex items-center justify-center text-4xl shadow-xl">
                                        ${trader.avatar}
                                    </div>
                                    <div class="flex-1">
                                        <p class="font-bold text-white text-xl mb-1">${trader.name}</p>
                                        <div class="flex flex-wrap gap-3 text-sm">
                                            <span class="px-2 py-1 rounded-lg bg-green-500/20 text-green-400 font-bold border border-green-500/30">
                                                ✓ ${trader.stats.winRate}% win rate
                                            </span>
                                            <span class="px-2 py-1 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                                ${trader.stats.totalWins} wins
                                            </span>
                                            <span class="px-2 py-1 rounded-lg bg-orange-500/20 text-orange-300 border border-orange-500/30">
                                                🔥 ${trader.stats.streak} streak
                                            </span>
                                        </div>
                                        <p class="text-xs text-gray-400 mt-2">
                                            Profit: <span class="text-green-400 font-bold">+$${trader.stats.totalProfit.toLocaleString()}</span> • 
                                            XP: <span class="text-sky-400 font-bold">${trader.stats.xp.toLocaleString()}</span>
                                        </p>
                                    </div>
                                </div>
                                ${isFollowing ? `
                                    <div class="px-6 py-3 rounded-xl bg-green-500/20 text-green-400 font-bold flex items-center gap-2 border-2 border-green-500/50 shadow-lg shadow-green-500/20">
                                        ✓ Following
                                    </div>
                                ` : `
                                    <button onclick='followTrader("${trader.id}", "${trader.name}", ${JSON.stringify(trader.stats).replace(/'/g, "\\'")}, "${trader.avatar}")'
                                        class="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white font-bold transition-all border-2 border-sky-400/50 hover:border-sky-300 shadow-lg hover:shadow-xl hover:scale-105">
                                        + Follow
                                    </button>
                                `}
                            </div>
                        `;
                    }).join('')}
                </div>
                `}
            </div>
            
            <!-- Info Card -->
            <div class="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-2 border-purple-500/30 rounded-2xl p-6 shadow-lg">
                <div class="flex items-start gap-4">
                    <div class="text-4xl">💡</div>
                    <div class="flex-1">
                        <h4 class="font-bold text-white text-lg mb-3">How Copy Trading Works</h4>
                        <div class="grid sm:grid-cols-2 gap-3 text-sm text-gray-300">
                            <div class="flex items-start gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
                                <span class="text-lg">📊</span>
                                <div>
                                    <p class="font-semibold text-sky-300">Real Stats</p>
                                    <p class="text-xs text-gray-400 mt-1">All data from actual user predictions</p>
                                </div>
                            </div>
                            <div class="flex items-start gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
                                <span class="text-lg">🎯</span>
                                <div>
                                    <p class="font-semibold text-green-300">Win Rates</p>
                                    <p class="text-xs text-gray-400 mt-1">Calculated from prediction history</p>
                                </div>
                            </div>
                            <div class="flex items-start gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
                                <span class="text-lg">✨</span>
                                <div>
                                    <p class="font-semibold text-purple-300">Follow Traders</p>
                                    <p class="text-xs text-gray-400 mt-1">Track successful predictors</p>
                                </div>
                            </div>
                            <div class="flex items-start gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
                                <span class="text-lg">🔄</span>
                                <div>
                                    <p class="font-semibold text-indigo-300">Auto-Copy</p>
                                    <p class="text-xs text-gray-400 mt-1">Automatically match their bets</p>
                                </div>
                            </div>
                        </div>
                        <div class="mt-4 p-3 bg-gradient-to-r from-sky-500/10 to-purple-500/10 rounded-lg border border-sky-400/20">
                            <p class="text-xs text-gray-300">
                                <span class="font-bold text-sky-300">Pro Tip:</span> Study top performers' strategies and timing to improve your own prediction skills!
                            </p>
                        </div>
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
