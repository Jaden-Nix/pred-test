/**
 * PORTFOLIO ANALYTICS DASHBOARD
 * Advanced analytics with real Firebase data - profit/loss, win rate trends, performance charts
 */

let portfolioChart = null;
let winRateChart = null;

// Initialize portfolio dashboard
async function initPortfolioDashboard() {
    console.log('📊 Initializing portfolio analytics dashboard...');
    
    // Check if user is authenticated
    if (!window.currentUser) {
        console.log('⚠️ Portfolio dashboard requires authentication');
        return;
    }
    
    // Load Chart.js if not already loaded
    await loadChartJS();
    
    // Render dashboard
    renderPortfolioDashboard();
    
    console.log('✅ Portfolio dashboard initialized!');
}

// Load Chart.js library
function loadChartJS() {
    return new Promise((resolve, reject) => {
        if (window.Chart) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Render portfolio dashboard UI
function renderPortfolioDashboard() {
    const container = document.getElementById('portfolio-analytics-container');
    if (!container) {
        console.warn('Portfolio analytics container not found');
        return;
    }
    
    const profile = window.userProfile || {};
    
    // Calculate analytics from real data
    const analytics = calculatePortfolioAnalytics(profile);
    
    container.innerHTML = `
        <!-- Analytics Header -->
        <div class="mb-6">
            <h2 class="text-2xl font-bold text-white mb-2">📊 Portfolio Analytics</h2>
            <p class="text-gray-400">Real-time insights from your prediction history</p>
        </div>
        
        <!-- Key Metrics Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <!-- Total PnL -->
            <div class="bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 rounded-2xl p-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-2xl">💰</span>
                    <span class="text-xs font-semibold text-emerald-400 uppercase">Total P&L</span>
                </div>
                <div class="text-2xl font-bold ${analytics.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}">
                    ${analytics.totalPnL >= 0 ? '+' : ''}${analytics.totalPnL.toLocaleString()}
                </div>
                <div class="text-xs text-gray-400 mt-1">
                    ${analytics.totalPredictions} predictions
                </div>
            </div>
            
            <!-- Win Rate -->
            <div class="bg-gradient-to-br from-sky-500/20 to-blue-500/20 border border-sky-500/30 rounded-2xl p-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-2xl">🎯</span>
                    <span class="text-xs font-semibold text-sky-400 uppercase">Win Rate</span>
                </div>
                <div class="text-2xl font-bold text-sky-400">
                    ${analytics.winRate.toFixed(1)}%
                </div>
                <div class="text-xs text-gray-400 mt-1">
                    ${analytics.wins}W / ${analytics.losses}L
                </div>
            </div>
            
            <!-- ROI -->
            <div class="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-2xl p-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-2xl">📈</span>
                    <span class="text-xs font-semibold text-purple-400 uppercase">ROI</span>
                </div>
                <div class="text-2xl font-bold ${analytics.roi >= 0 ? 'text-purple-400' : 'text-red-400'}">
                    ${analytics.roi >= 0 ? '+' : ''}${analytics.roi.toFixed(1)}%
                </div>
                <div class="text-xs text-gray-400 mt-1">
                    Return on investment
                </div>
            </div>
            
            <!-- Streak -->
            <div class="bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-2xl p-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-2xl">🔥</span>
                    <span class="text-xs font-semibold text-orange-400 uppercase">Streak</span>
                </div>
                <div class="text-2xl font-bold text-orange-400">
                    ${analytics.currentStreak} days
                </div>
                <div class="text-xs text-gray-400 mt-1">
                    Best: ${analytics.bestStreak} days
                </div>
            </div>
        </div>
        
        <!-- Charts Row -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <!-- Portfolio Value Chart -->
            <div class="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 class="text-lg font-bold text-white mb-4">💎 Portfolio Value</h3>
                <canvas id="portfolio-chart" class="w-full" style="max-height: 250px;"></canvas>
            </div>
            
            <!-- Win Rate Trend Chart -->
            <div class="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 class="text-lg font-bold text-white mb-4">🎯 Win Rate Trend</h3>
                <canvas id="winrate-chart" class="w-full" style="max-height: 250px;"></canvas>
            </div>
        </div>
        
        <!-- Performance Breakdown -->
        <div class="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 class="text-lg font-bold text-white mb-4">📊 Performance by Category</h3>
            <div class="space-y-3">
                ${analytics.categories.map(cat => `
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-sm text-gray-300">${cat.name}</span>
                            <span class="text-sm font-semibold ${cat.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}">
                                ${cat.winRate.toFixed(0)}% (${cat.count} predictions)
                            </span>
                        </div>
                        <div class="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                            <div 
                                class="h-full ${cat.winRate >= 50 ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-red-500 to-orange-500'} transition-all duration-500"
                                style="width: ${cat.winRate}%"
                            ></div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <!-- Risk Metrics -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div class="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div class="text-xs text-gray-400 uppercase mb-2">Avg Stake</div>
                <div class="text-xl font-bold text-white">${analytics.avgStake.toLocaleString()}</div>
            </div>
            <div class="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div class="text-xs text-gray-400 uppercase mb-2">Biggest Win</div>
                <div class="text-xl font-bold text-emerald-400">+${analytics.biggestWin.toLocaleString()}</div>
            </div>
            <div class="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div class="text-xs text-gray-400 uppercase mb-2">Biggest Loss</div>
                <div class="text-xl font-bold text-red-400">-${analytics.biggestLoss.toLocaleString()}</div>
            </div>
        </div>
    `;
    
    // Render charts after a short delay
    setTimeout(() => {
        renderPortfolioChart(analytics);
        renderWinRateChart(analytics);
    }, 100);
}

// Calculate portfolio analytics from real Firebase data
function calculatePortfolioAnalytics(profile) {
    const predictions = profile.predictions || [];
    const totalPredictions = predictions.length;
    
    // Calculate wins/losses
    const resolvedPredictions = predictions.filter(p => p.resolved);
    const wins = resolvedPredictions.filter(p => p.won).length;
    const losses = resolvedPredictions.filter(p => !p.won).length;
    const winRate = resolvedPredictions.length > 0 ? (wins / resolvedPredictions.length) * 100 : 0;
    
    // Calculate P&L
    const totalPnL = resolvedPredictions.reduce((sum, p) => {
        const stake = p.amount || 100;
        return sum + (p.won ? stake : -stake);
    }, 0);
    
    // Calculate ROI
    const totalStaked = resolvedPredictions.reduce((sum, p) => sum + (p.amount || 100), 0);
    const roi = totalStaked > 0 ? (totalPnL / totalStaked) * 100 : 0;
    
    // Streaks
    const currentStreak = profile.streak || 0;
    const bestStreak = profile.bestStreak || currentStreak;
    
    // Average stake
    const avgStake = totalPredictions > 0 ? predictions.reduce((sum, p) => sum + (p.amount || 100), 0) / totalPredictions : 0;
    
    // Biggest win/loss
    let biggestWin = 0;
    let biggestLoss = 0;
    resolvedPredictions.forEach(p => {
        const stake = p.amount || 100;
        if (p.won && stake > biggestWin) biggestWin = stake;
        if (!p.won && stake > biggestLoss) biggestLoss = stake;
    });
    
    // Category breakdown
    const categoryStats = {};
    predictions.forEach(p => {
        const cat = p.category || 'General';
        if (!categoryStats[cat]) {
            categoryStats[cat] = { wins: 0, total: 0 };
        }
        categoryStats[cat].total++;
        if (p.resolved && p.won) categoryStats[cat].wins++;
    });
    
    const categories = Object.entries(categoryStats)
        .map(([name, stats]) => ({
            name,
            count: stats.total,
            winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    
    // Time series data (last 30 days)
    const timeSeriesData = generateTimeSeriesData(predictions);
    
    return {
        totalPredictions,
        wins,
        losses,
        winRate,
        totalPnL,
        roi,
        currentStreak,
        bestStreak,
        avgStake: Math.round(avgStake),
        biggestWin,
        biggestLoss,
        categories,
        timeSeriesData
    };
}

// Generate time series data for charts
function generateTimeSeriesData(predictions) {
    const days = 30;
    const data = [];
    const now = Date.now();
    
    for (let i = days - 1; i >= 0; i--) {
        const dayStart = now - (i * 24 * 60 * 60 * 1000);
        const dayEnd = dayStart + (24 * 60 * 60 * 1000);
        
        const dayPredictions = predictions.filter(p => {
            const timestamp = p.timestamp || Date.now();
            return timestamp >= dayStart && timestamp < dayEnd;
        });
        
        const resolved = dayPredictions.filter(p => p.resolved);
        const wins = resolved.filter(p => p.won).length;
        const dayWinRate = resolved.length > 0 ? (wins / resolved.length) * 100 : null;
        
        const pnl = resolved.reduce((sum, p) => {
            const stake = p.amount || 100;
            return sum + (p.won ? stake : -stake);
        }, 0);
        
        data.push({
            date: new Date(dayStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            pnl,
            winRate: dayWinRate,
            cumulativePnL: data.length > 0 ? data[data.length - 1].cumulativePnL + pnl : pnl
        });
    }
    
    return data;
}

// Render portfolio value chart
function renderPortfolioChart(analytics) {
    const canvas = document.getElementById('portfolio-chart');
    if (!canvas || !window.Chart) return;
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (portfolioChart) {
        portfolioChart.destroy();
    }
    
    portfolioChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: analytics.timeSeriesData.map(d => d.date),
            datasets: [{
                label: 'Cumulative P&L',
                data: analytics.timeSeriesData.map(d => d.cumulativePnL),
                borderColor: 'rgb(56, 189, 248)',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointBackgroundColor: 'rgb(56, 189, 248)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(56, 189, 248, 0.5)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => `P&L: ${context.parsed.y >= 0 ? '+' : ''}${context.parsed.y.toLocaleString()}`
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        maxRotation: 0,
                        autoSkipPadding: 20
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        callback: (value) => `${value >= 0 ? '+' : ''}${value}`
                    }
                }
            }
        }
    });
}

// Render win rate trend chart
function renderWinRateChart(analytics) {
    const canvas = document.getElementById('winrate-chart');
    if (!canvas || !window.Chart) return;
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (winRateChart) {
        winRateChart.destroy();
    }
    
    // Filter out null values (days with no predictions)
    const validData = analytics.timeSeriesData.filter(d => d.winRate !== null);
    
    winRateChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: validData.map(d => d.date),
            datasets: [{
                label: 'Daily Win Rate',
                data: validData.map(d => d.winRate),
                backgroundColor: validData.map(d => 
                    d.winRate >= 50 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
                ),
                borderColor: validData.map(d => 
                    d.winRate >= 50 ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)'
                ),
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(56, 189, 248, 0.5)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => `Win Rate: ${context.parsed.y.toFixed(1)}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        maxRotation: 0,
                        autoSkipPadding: 20
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        callback: (value) => `${value}%`
                    }
                }
            }
        }
    });
}

// Export functions
window.initPortfolioDashboard = initPortfolioDashboard;
window.renderPortfolioDashboard = renderPortfolioDashboard;

console.log('📊 Portfolio Analytics Dashboard module loaded!');
