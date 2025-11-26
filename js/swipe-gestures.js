/**
 * SWIPE GESTURES MODULE
 * Handles swipe-to-stake interactions for Quick Play
 */

class SwipeGestureHandler {
    constructor() {
        this.startX = 0;
        this.startY = 0;
        this.endX = 0;
        this.endY = 0;
        this.minSwipeDistance = 50;
        this.activeElement = null;
    }

    init(element) {
        if (!element) return;

        element.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        element.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        element.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });

        // Mouse support for desktop
        element.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        element.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        element.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        this.activeElement = element;
    }

    handleTouchStart(e) {
        this.startX = e.touches[0].clientX;
        this.startY = e.touches[0].clientY;
    }

    handleTouchMove(e) {
        if (!this.startX || !this.startY) return;

        this.endX = e.touches[0].clientX;
        this.endY = e.touches[0].clientY;

        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;

        // Visual feedback during swipe
        if (Math.abs(diffX) > 20) {
            this.showSwipeIndicator(diffX > 0 ? 'YES' : 'NO', Math.abs(diffX));
        }
    }

    handleTouchEnd(e) {
        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;

        // Check if horizontal swipe
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.minSwipeDistance) {
            const direction = diffX > 0 ? 'YES' : 'NO';
            this.triggerStake(direction);
        }

        this.hideSwipeIndicator();
        this.reset();
    }

    handleMouseDown(e) {
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.activeElement.style.cursor = 'grabbing';
    }

    handleMouseMove(e) {
        if (!this.startX) return;

        this.endX = e.clientX;
        this.endY = e.clientY;

        const diffX = this.endX - this.startX;

        if (Math.abs(diffX) > 20) {
            this.showSwipeIndicator(diffX > 0 ? 'YES' : 'NO', Math.abs(diffX));
        }
    }

    handleMouseUp(e) {
        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.minSwipeDistance) {
            const direction = diffX > 0 ? 'YES' : 'NO';
            this.triggerStake(direction);
        }

        this.hideSwipeIndicator();
        this.reset();
        if (this.activeElement) {
            this.activeElement.style.cursor = 'grab';
        }
    }

    showSwipeIndicator(direction, distance) {
        let indicator = document.getElementById('swipe-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'swipe-indicator';
            indicator.className = 'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 transition-all duration-200';
            document.body.appendChild(indicator);
        }

        const opacity = Math.min(distance / 100, 1);
        const scale = 0.5 + (opacity * 0.5);

        if (direction === 'YES') {
            indicator.innerHTML = `
                <div class="swipe-feedback bg-gradient-to-r from-green-500/80 to-emerald-500/80 backdrop-blur-xl px-12 py-8 rounded-3xl shadow-2xl border-4 border-green-400/50" style="opacity: ${opacity}; transform: scale(${scale})">
                    <div class="text-center">
                        <div class="text-7xl mb-2">👍</div>
                        <p class="text-3xl font-bold text-white">YES!</p>
                    </div>
                </div>
            `;
        } else {
            indicator.innerHTML = `
                <div class="swipe-feedback bg-gradient-to-r from-red-500/80 to-pink-500/80 backdrop-blur-xl px-12 py-8 rounded-3xl shadow-2xl border-4 border-red-400/50" style="opacity: ${opacity}; transform: scale(${scale})">
                    <div class="text-center">
                        <div class="text-7xl mb-2">👎</div>
                        <p class="text-3xl font-bold text-white">NO!</p>
                    </div>
                </div>
            `;
        }
    }

    hideSwipeIndicator() {
        const indicator = document.getElementById('swipe-indicator');
        if (indicator) {
            indicator.style.opacity = '0';
            setTimeout(() => indicator.remove(), 300);
        }
    }

    triggerStake(direction) {
        console.log('Swipe stake:', direction);
        
        // Haptic feedback (if supported)
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }

        // Trigger the existing quick play stake logic
        if (typeof window.handleQuickPlay === 'function') {
            window.handleQuickPlay(direction.toLowerCase());
        } else {
            console.log('Quick play handler not available yet');
        }

        // Show success animation
        this.showStakeSuccess(direction);
    }

    showStakeSuccess(direction) {
        const success = document.createElement('div');
        success.className = 'fixed inset-0 z-40 flex items-center justify-center pointer-events-none';
        success.innerHTML = `
            <div class="stake-success-animation ${direction === 'YES' ? 'bg-green-500/20' : 'bg-red-500/20'} backdrop-blur-sm rounded-full p-20 scale-0 transition-transform duration-500">
                <div class="text-9xl">${direction === 'YES' ? '✅' : '❌'}</div>
            </div>
        `;
        
        document.body.appendChild(success);
        
        setTimeout(() => {
            success.querySelector('.stake-success-animation').style.transform = 'scale(1)';
        }, 50);
        
        setTimeout(() => {
            success.querySelector('.stake-success-animation').style.transform = 'scale(0)';
            setTimeout(() => success.remove(), 500);
        }, 800);
    }

    reset() {
        this.startX = 0;
        this.startY = 0;
        this.endX = 0;
        this.endY = 0;
    }
}

// Initialize swipe gestures for Quick Play
function initSwipeGestures() {
    // Try both IDs to find Quick Play content
    const quickPlayContainer = document.getElementById('quick-play-content') || 
                                document.getElementById('quick-play-container') ||
                                document.getElementById('pledge-pool-content');
    
    if (quickPlayContainer) {
        const swipeHandler = new SwipeGestureHandler();
        swipeHandler.init(quickPlayContainer);
        console.log('✨ Swipe gestures initialized for Quick Play!', quickPlayContainer.id);
    } else {
        console.log('⚠️ Quick Play container not found for swipe gestures');
    }
}

// Export
window.SwipeGestureHandler = SwipeGestureHandler;
window.initSwipeGestures = initSwipeGestures;
