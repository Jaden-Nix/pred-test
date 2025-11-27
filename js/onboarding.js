/**
 * WIZARD-STYLE ONBOARDING
 * Full-screen step-by-step feature showcase for new users
 */

const wizardSteps = [
    {
        icon: '🎉',
        title: 'Welcome to Predora',
        subtitle: 'The AI-Native Prediction Market',
        description: 'Turn your predictions into profits. Stake on real-world events and earn when you\'re right.',
        features: [
            '🎯 Predict outcomes on sports, crypto, politics & more',
            '💰 Win real rewards when your predictions are correct',
            '🤖 AI-powered market resolution for fair outcomes'
        ],
        gradient: 'from-indigo-600 via-purple-600 to-pink-600'
    },
    {
        icon: '📊',
        title: 'Prediction Markets',
        subtitle: 'Browse & Stake on Events',
        description: 'Explore hundreds of markets across different categories. Each market is a question about a future event.',
        features: [
            '📈 See live odds updated in real-time',
            '🏷️ Filter by Crypto, Sports, Politics, Tech & more',
            '💵 Stake any amount on YES or NO'
        ],
        gradient: 'from-sky-600 via-cyan-600 to-teal-600'
    },
    {
        icon: '⚡',
        title: 'Quick Play',
        subtitle: 'Swipe to Predict',
        description: 'Fast, fun predictions with a Tinder-style interface. Swipe right for YES, left for NO!',
        features: [
            '👆 Swipe or tap to make instant predictions',
            '🎮 Gamified experience with streaks & achievements',
            '⏱️ Quick markets that resolve within 24 hours'
        ],
        gradient: 'from-amber-500 via-orange-500 to-red-500'
    },
    {
        icon: '🌟',
        title: 'Social Feed',
        subtitle: 'Connect & Learn',
        description: 'Follow top predictors, share your wins, and learn from the community\'s insights.',
        features: [
            '👥 Follow successful traders and see their picks',
            '💬 Comment and discuss market outcomes',
            '🏆 Climb the leaderboard and earn badges'
        ],
        gradient: 'from-green-500 via-emerald-500 to-teal-500'
    },
    {
        icon: '💎',
        title: 'Copy Trading',
        subtitle: 'Smart Investing Made Easy',
        description: 'Automatically mirror the predictions of top performers. Let the experts work for you!',
        features: [
            '📋 One-click copy any trader\'s strategy',
            '📊 Track performance with detailed analytics',
            '🔄 Auto-sync predictions in real-time'
        ],
        gradient: 'from-violet-600 via-purple-600 to-fuchsia-600'
    },
    {
        icon: '🚀',
        title: 'You\'re Ready!',
        subtitle: 'Start Predicting Now',
        description: 'Your journey begins here. Make your first prediction and see how good your instincts are!',
        features: [
            '🎁 New users get bonus starting balance',
            '📱 Works great on mobile & desktop',
            '🔔 Get notified when your markets resolve'
        ],
        gradient: 'from-rose-500 via-pink-500 to-purple-600'
    }
];

let currentWizardStep = 0;
let wizardContainer = null;

function shouldShowOnboarding() {
    const completed = localStorage.getItem('predora_onboarding_complete');
    return !completed;
}

function startOnboarding() {
    if (!shouldShowOnboarding()) return;
    
    console.log('🎓 Starting wizard onboarding...');
    currentWizardStep = 0;
    createWizardUI();
    showWizardStep(0);
}

function createWizardUI() {
    wizardContainer = document.createElement('div');
    wizardContainer.id = 'onboarding-wizard';
    wizardContainer.className = 'fixed inset-0 z-[9999] flex items-center justify-center';
    wizardContainer.innerHTML = `
        <div class="absolute inset-0 bg-black/95 backdrop-blur-xl"></div>
        <div class="relative w-full max-w-lg mx-4 animate-fade-in">
            <div id="wizard-card" class="relative overflow-hidden rounded-3xl shadow-2xl">
                <div id="wizard-bg" class="absolute inset-0 bg-gradient-to-br opacity-90 transition-all duration-700"></div>
                <div class="relative p-8 md:p-10">
                    <div id="wizard-icon" class="text-7xl md:text-8xl text-center mb-6 transform transition-all duration-500"></div>
                    <h1 id="wizard-title" class="text-3xl md:text-4xl font-bold text-white text-center mb-2 transition-all duration-500"></h1>
                    <p id="wizard-subtitle" class="text-lg text-white/80 text-center mb-6 transition-all duration-500"></p>
                    <p id="wizard-description" class="text-white/90 text-center mb-8 leading-relaxed transition-all duration-500"></p>
                    <div id="wizard-features" class="space-y-3 mb-8"></div>
                    
                    <div class="flex items-center justify-between">
                        <div id="wizard-dots" class="flex gap-2"></div>
                        <div class="flex gap-3">
                            <button id="wizard-skip" class="px-4 py-2 text-white/70 hover:text-white font-medium transition-colors">
                                Skip
                            </button>
                            <button id="wizard-next" class="px-8 py-3 bg-white text-gray-900 rounded-xl font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200">
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(wizardContainer);
    
    document.getElementById('wizard-skip').onclick = () => {
        if (confirm('Skip the tour? You can restart it from Settings anytime.')) {
            completeOnboarding();
        }
    };
    document.getElementById('wizard-next').onclick = nextWizardStep;
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fade-in {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in { animation: fade-in 0.4s ease-out; }
        @keyframes slide-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.5s ease-out forwards; }
    `;
    document.head.appendChild(style);
}

function showWizardStep(index) {
    const step = wizardSteps[index];
    
    const bg = document.getElementById('wizard-bg');
    bg.className = `absolute inset-0 bg-gradient-to-br ${step.gradient} opacity-90 transition-all duration-700`;
    
    const icon = document.getElementById('wizard-icon');
    icon.style.transform = 'scale(0.5)';
    icon.style.opacity = '0';
    setTimeout(() => {
        icon.textContent = step.icon;
        icon.style.transform = 'scale(1)';
        icon.style.opacity = '1';
    }, 150);
    
    document.getElementById('wizard-title').textContent = step.title;
    document.getElementById('wizard-subtitle').textContent = step.subtitle;
    document.getElementById('wizard-description').textContent = step.description;
    
    const featuresContainer = document.getElementById('wizard-features');
    featuresContainer.innerHTML = step.features.map((feature, i) => `
        <div class="animate-slide-up bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 text-white/95 text-sm md:text-base" style="animation-delay: ${i * 0.1}s; opacity: 0;">
            ${feature}
        </div>
    `).join('');
    
    const dotsContainer = document.getElementById('wizard-dots');
    dotsContainer.innerHTML = wizardSteps.map((_, i) => `
        <button onclick="goToWizardStep(${i})" class="w-2.5 h-2.5 rounded-full transition-all duration-300 ${i === index ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'}"></button>
    `).join('');
    
    const nextBtn = document.getElementById('wizard-next');
    if (index === wizardSteps.length - 1) {
        nextBtn.textContent = 'Get Started! 🚀';
        nextBtn.className = 'px-8 py-3 bg-white text-gray-900 rounded-xl font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 animate-pulse';
    } else {
        nextBtn.textContent = 'Next';
        nextBtn.className = 'px-8 py-3 bg-white text-gray-900 rounded-xl font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200';
    }
}

function nextWizardStep() {
    currentWizardStep++;
    if (currentWizardStep >= wizardSteps.length) {
        completeOnboarding();
    } else {
        showWizardStep(currentWizardStep);
    }
}

function goToWizardStep(index) {
    currentWizardStep = index;
    showWizardStep(index);
}

function completeOnboarding() {
    try {
        localStorage.setItem('predora_onboarding_complete', 'true');
        
        if (wizardContainer) {
            wizardContainer.style.opacity = '0';
            wizardContainer.style.transition = 'opacity 0.4s ease-out';
            
            setTimeout(() => {
                wizardContainer?.remove();
                wizardContainer = null;
                showWelcomeToast();
                console.log('✅ Onboarding complete!');
            }, 400);
        }
    } catch (err) {
        console.error('Error completing onboarding:', err);
        document.getElementById('onboarding-wizard')?.remove();
    }
}

function showWelcomeToast() {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-slide-up';
    toast.innerHTML = `
        <span class="text-2xl">🎉</span>
        <span class="font-semibold">Welcome! Make your first prediction to get started.</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function restartOnboarding() {
    localStorage.removeItem('predora_onboarding_complete');
    currentWizardStep = 0;
    startOnboarding();
}

window.startOnboarding = startOnboarding;
window.restartOnboarding = restartOnboarding;
window.shouldShowOnboarding = shouldShowOnboarding;
window.goToWizardStep = goToWizardStep;

console.log('🎓 Onboarding wizard loaded!');
