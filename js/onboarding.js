/**
 * INTERACTIVE ONBOARDING SYSTEM
 * Beautiful tutorial that guides new users through Predora's features
 */

const onboardingSteps = [
    {
        target: '#home-screen',
        title: '🎉 Welcome to Predora!',
        message: 'The AI-native prediction market where your insights earn rewards. Let me show you around!',
        position: 'center',
        action: null
    },
    {
        target: '.market-card',
        title: '📊 Prediction Markets',
        message: 'Each market is a real event where you can stake on YES or NO. Win when you\'re right!',
        position: 'bottom',
        highlight: true
    },
    {
        target: '[data-screen="quick-play-screen"]',
        title: '⚡ Quick Play',
        message: 'Swipe right for YES, left for NO! Fast predictions with instant gratification.',
        position: 'top',
        highlight: true
    },
    {
        target: '[data-screen="social-feed-screen"]',
        title: '🌟 Social Feed',
        message: 'Follow top predictors, share insights, and learn from the community!',
        position: 'top',
        highlight: true
    },
    {
        target: '[data-screen="copy-trading-screen"]',
        title: '💎 Copy Trading',
        message: 'Automatically copy predictions from the best traders. Smart investing made easy!',
        position: 'top',
        highlight: true
    },
    {
        target: '[data-screen="profile-screen"]',
        title: '🏆 Your Profile',
        message: 'Track your XP, win rate, streak, and climb the leaderboard. Let\'s make your first prediction!',
        position: 'top',
        highlight: true,
        action: 'complete'
    }
];

let currentStep = 0;
let onboardingOverlay = null;
let onboardingTooltip = null;
let onboardingComplete = false;

// Check if user has completed onboarding
function shouldShowOnboarding() {
    const completed = localStorage.getItem('predora_onboarding_complete');
    return !completed;
}

// Start onboarding flow
function startOnboarding() {
    if (!shouldShowOnboarding()) return;
    
    console.log('🎓 Starting interactive onboarding...');
    currentStep = 0;
    createOnboardingUI();
    showStep(currentStep);
}

// Create overlay and tooltip elements
function createOnboardingUI() {
    // Create dark overlay
    onboardingOverlay = document.createElement('div');
    onboardingOverlay.id = 'onboarding-overlay';
    onboardingOverlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9998] transition-opacity duration-300';
    onboardingOverlay.style.opacity = '0';
    document.body.appendChild(onboardingOverlay);
    
    // Fade in overlay
    requestAnimationFrame(() => {
        onboardingOverlay.style.opacity = '1';
    });
    
    // Create tooltip
    onboardingTooltip = document.createElement('div');
    onboardingTooltip.id = 'onboarding-tooltip';
    onboardingTooltip.className = 'fixed z-[9999] max-w-sm transition-all duration-500 transform';
    onboardingTooltip.innerHTML = `
        <div class="bg-gradient-to-br from-sky-500 to-indigo-600 rounded-2xl shadow-2xl p-6 relative">
            <div class="absolute -top-2 -right-2 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg animate-bounce">
                <span class="text-2xl">👋</span>
            </div>
            <h3 id="onboarding-title" class="text-xl font-bold text-white mb-2"></h3>
            <p id="onboarding-message" class="text-white/90 mb-4 leading-relaxed"></p>
            <div class="flex items-center justify-between gap-3">
                <div id="onboarding-dots" class="flex gap-2"></div>
                <div class="flex gap-2">
                    <button id="onboarding-skip" class="px-4 py-2 text-sm font-semibold text-white/80 hover:text-white transition-colors">
                        Skip
                    </button>
                    <button id="onboarding-next" class="px-6 py-2 bg-white text-indigo-600 rounded-lg font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200">
                        Next
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(onboardingTooltip);
    
    // Add event listeners
    document.getElementById('onboarding-skip').onclick = skipOnboarding;
    document.getElementById('onboarding-next').onclick = nextStep;
}

// Show specific onboarding step
function showStep(stepIndex) {
    if (stepIndex >= onboardingSteps.length) {
        completeOnboarding();
        return;
    }
    
    const step = onboardingSteps[stepIndex];
    
    // Update tooltip content
    document.getElementById('onboarding-title').textContent = step.title;
    document.getElementById('onboarding-message').textContent = step.message;
    
    // Update progress dots
    const dotsContainer = document.getElementById('onboarding-dots');
    dotsContainer.innerHTML = onboardingSteps.map((_, i) => 
        `<div class="w-2 h-2 rounded-full ${i === stepIndex ? 'bg-white' : 'bg-white/30'} transition-all duration-300"></div>`
    ).join('');
    
    // Update next button text
    const nextBtn = document.getElementById('onboarding-next');
    nextBtn.textContent = step.action === 'complete' ? 'Get Started! 🚀' : 'Next';
    
    // Position tooltip
    if (step.position === 'center') {
        positionTooltipCenter();
    } else {
        positionTooltipNearTarget(step.target, step.position);
    }
    
    // Highlight target element
    if (step.highlight) {
        highlightElement(step.target);
    } else {
        clearHighlight();
    }
}

// Position tooltip in center of screen
function positionTooltipCenter() {
    onboardingTooltip.style.top = '50%';
    onboardingTooltip.style.left = '50%';
    onboardingTooltip.style.transform = 'translate(-50%, -50%) scale(1)';
}

// Position tooltip near target element
function positionTooltipNearTarget(selector, position) {
    const target = document.querySelector(selector);
    if (!target) {
        positionTooltipCenter();
        return;
    }
    
    const rect = target.getBoundingClientRect();
    const tooltip = onboardingTooltip;
    
    switch (position) {
        case 'top':
            tooltip.style.top = `${rect.top - 20}px`;
            tooltip.style.left = `${rect.left + rect.width / 2}px`;
            tooltip.style.transform = 'translate(-50%, -100%) scale(1)';
            break;
        case 'bottom':
            tooltip.style.top = `${rect.bottom + 20}px`;
            tooltip.style.left = `${rect.left + rect.width / 2}px`;
            tooltip.style.transform = 'translate(-50%, 0) scale(1)';
            break;
        case 'left':
            tooltip.style.top = `${rect.top + rect.height / 2}px`;
            tooltip.style.left = `${rect.left - 20}px`;
            tooltip.style.transform = 'translate(-100%, -50%) scale(1)';
            break;
        case 'right':
            tooltip.style.top = `${rect.top + rect.height / 2}px`;
            tooltip.style.left = `${rect.right + 20}px`;
            tooltip.style.transform = 'translate(0, -50%) scale(1)';
            break;
    }
}

// Highlight target element
function highlightElement(selector) {
    clearHighlight();
    const target = document.querySelector(selector);
    if (!target) return;
    
    target.style.position = 'relative';
    target.style.zIndex = '9999';
    target.style.boxShadow = '0 0 0 4px rgba(56, 189, 248, 0.5), 0 0 40px rgba(56, 189, 248, 0.3)';
    target.style.borderRadius = '1rem';
    target.style.transition = 'all 0.3s ease';
    target.classList.add('onboarding-highlight');
}

// Clear element highlight
function clearHighlight() {
    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.style.zIndex = '';
        el.style.boxShadow = '';
        el.classList.remove('onboarding-highlight');
    });
}

// Go to next step
function nextStep() {
    currentStep++;
    showStep(currentStep);
}

// Skip onboarding
function skipOnboarding() {
    if (confirm('Are you sure you want to skip the tour? You can restart it from Settings.')) {
        completeOnboarding();
    }
}

// Complete onboarding
function completeOnboarding() {
    localStorage.setItem('predora_onboarding_complete', 'true');
    
    // Show completion celebration
    showCelebration();
    
    // Fade out and remove UI
    onboardingOverlay.style.opacity = '0';
    onboardingTooltip.style.transform = onboardingTooltip.style.transform.replace('scale(1)', 'scale(0.8)');
    onboardingTooltip.style.opacity = '0';
    
    setTimeout(() => {
        clearHighlight();
        onboardingOverlay?.remove();
        onboardingTooltip?.remove();
        onboardingOverlay = null;
        onboardingTooltip = null;
        console.log('✅ Onboarding complete!');
    }, 300);
}

// Show celebration animation
function showCelebration() {
    const celebration = document.createElement('div');
    celebration.className = 'fixed inset-0 z-[10000] pointer-events-none flex items-center justify-center';
    celebration.innerHTML = `
        <div class="text-center animate-bounce">
            <div class="text-8xl mb-4">🎉</div>
            <div class="text-3xl font-bold text-white bg-gradient-to-r from-sky-400 to-indigo-600 px-8 py-4 rounded-2xl shadow-2xl">
                You're all set!
            </div>
        </div>
    `;
    document.body.appendChild(celebration);
    
    setTimeout(() => celebration.remove(), 2000);
}

// Restart onboarding (from settings)
function restartOnboarding() {
    localStorage.removeItem('predora_onboarding_complete');
    startOnboarding();
}

// Export functions
window.startOnboarding = startOnboarding;
window.restartOnboarding = restartOnboarding;
window.shouldShowOnboarding = shouldShowOnboarding;

console.log('🎓 Onboarding system loaded!');
