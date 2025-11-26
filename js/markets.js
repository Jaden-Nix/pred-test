/**
 * MARKETS MODULE
 * Handles market creation, filtering, display, and betting logic
 */

// Market state
let allStandardMarkets = [];
let allQuickMarkets = [];
let currentFilter = 'All';
let marketNotifications = {}; // { marketId: unreadCount }

// Market filtering
function filterByCategory(category) {
    currentFilter = category;
    console.log('Filtering by category:', category);
    
    const categoryBtns = document.querySelectorAll('[data-filter]');
    categoryBtns.forEach(btn => {
        if (btn.dataset.filter === category) {
            btn.classList.add('active-filter');
            btn.classList.remove('inactive-filter');
        } else {
            btn.classList.remove('active-filter');
            btn.classList.add('inactive-filter');
        }
    });
    
    renderMarkets();
}

// Render markets to UI
function renderMarkets() {
    // Filter markets based on current category
    let filtered = currentFilter === 'All' 
        ? allStandardMarkets 
        : allStandardMarkets.filter(m => m.category === currentFilter);
    
    // Add AI market cards and render
    const container = document.getElementById('markets-container');
    if (!container) return;
    
    container.innerHTML = filtered.map(market => createMarketCard(market)).join('');
    
    // Add interactive effects
    setTimeout(() => {
        addTrendingBadges();
        animateMarketCards();
    }, 100);
}

// Create market card HTML
function createMarketCard(market) {
    const yesPercent = market.yesPercent || 50;
    const noPercent = market.noPercent || 50;
    const unreadCount = marketNotifications[market.id] || 0;
    const notificationBadge = unreadCount > 0 
        ? `<span class="market-notification-badge">${unreadCount}</span>` 
        : '';
    
    return `
        <div class="ui-panel p-6 rounded-2xl hover-lift interactive market-card relative" data-market-id="${market.id}">
            ${notificationBadge}
            <div class="flex justify-between items-start mb-4">
                <div class="flex-1">
                    <span class="text-xs px-3 py-1 rounded-full bg-sky-500/20 text-sky-400">${market.category || 'General'}</span>
                    <h3 class="text-lg font-bold text-white mt-3">${market.question}</h3>
                </div>
            </div>
            
            <!-- AI Market Pulse Indicator -->
            <div class="market-pulse-bar mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="live-user-dot"></span>
                    <span class="text-xs text-gray-400">${getActivityLevel(market)} active now</span>
                </div>
                <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div class="h-full bg-gradient-to-r from-green-500 to-blue-500 pulse-glow" style="width: ${getActivityPercent(market)}%"></div>
                </div>
            </div>
            
            <!-- Odds Display -->
            <div class="grid grid-cols-2 gap-3 mb-4">
                <button onclick="placeBet('${market.id}', 'YES')" 
                    class="bet-button bg-green-500/20 hover:bg-green-500/30 text-green-400 font-bold py-3 px-4 rounded-xl transition-all">
                    YES ${yesPercent}%
                </button>
                <button onclick="placeBet('${market.id}', 'NO')" 
                    class="bet-button bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold py-3 px-4 rounded-xl transition-all">
                    NO ${noPercent}%
                </button>
            </div>
            
            <!-- AI Insight Card -->
            ${getAIInsightCard(market)}
            
            <div class="flex items-center justify-between text-xs text-gray-400 mt-4">
                <span>Resolves: ${formatDate(market.resolveDate)}</span>
                <span>${market.totalVolume || 0} predictions</span>
            </div>
        </div>
    `;
}

// Get activity level for market
function getActivityLevel(market) {
    const volume = market.totalVolume || 0;
    if (volume > 100) return `${volume}+ users`;
    if (volume > 50) return `${volume} users`;
    if (volume > 10) return `${volume} users`;
    return 'Few users';
}

// Get activity percentage (for pulse bar)
function getActivityPercent(market) {
    const volume = market.totalVolume || 0;
    return Math.min(100, (volume / 200) * 100);
}

// Format date helper
function formatDate(timestamp) {
    if (!timestamp) return 'TBD';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Place bet function
async function placeBet(marketId, pick) {
    console.log('Placing bet:', marketId, pick);
    // Implementation depends on existing Firebase logic
    // This will be wired up to the existing betting system
}

// Notification polling interval reference
let notificationInterval = null;

// Fetch market notifications from Firebase
async function fetchMarketNotifications() {
    try {
        // Check if user is authenticated and has a valid token
        if (!window.currentUser) {
            console.log('📊 Notification fetch skipped: No authenticated user');
            return;
        }
        
        const token = await window.currentUser.getIdToken();
        if (!token || token === 'undefined') {
            console.log('📊 Notification fetch skipped: Invalid token');
            return;
        }
        
        const response = await fetch('/api/notifications', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            console.log('📊 Notification fetch skipped: API returned', response.status);
            return;
        }
        
        const data = await response.json();
        const notifications = data.notifications || [];
        
        // Count unread notifications per market
        marketNotifications = {};
        notifications.forEach(notif => {
            if (!notif.read && notif.marketId) {
                marketNotifications[notif.marketId] = (marketNotifications[notif.marketId] || 0) + 1;
            }
        });
        
        console.log('📊 Market notifications loaded:', marketNotifications);
        
        // Re-render markets to show badges
        renderMarkets();
        
    } catch (error) {
        console.log('📊 Notification fetch error:', error.message);
    }
}

// Start notification polling (only for authenticated users)
function startNotificationPolling() {
    if (notificationInterval) {
        clearInterval(notificationInterval);
    }
    
    // Only start polling if user is authenticated
    if (window.currentUser) {
        console.log('📊 Starting notification polling for authenticated user');
        notificationInterval = setInterval(fetchMarketNotifications, 30000);
    }
}

// Stop notification polling
function stopNotificationPolling() {
    if (notificationInterval) {
        console.log('📊 Stopping notification polling');
        clearInterval(notificationInterval);
        notificationInterval = null;
    }
}

// Export functions for use in app.html
window.filterByCategory = filterByCategory;
window.renderMarkets = renderMarkets;
window.placeBet = placeBet;
window.fetchMarketNotifications = fetchMarketNotifications;
window.startNotificationPolling = startNotificationPolling;
window.stopNotificationPolling = stopNotificationPolling;
