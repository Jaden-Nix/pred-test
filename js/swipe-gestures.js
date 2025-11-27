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
        // Simplified: Just add a subtle glow to the card instead of big overlay
        const card = document.getElementById('quick-play-card');
        if (!card) return;
        
        const opacity = Math.min(distance / 150, 0.6);
        if (direction === 'YES') {
            card.style.boxShadow = `0 0 30px rgba(74, 222, 128, ${opacity})`;
        } else {
            card.style.boxShadow = `0 0 30px rgba(248, 113, 113, ${opacity})`;
        }
    }

    hideSwipeIndicator() {
        // Reset card glow
        const card = document.getElementById('quick-play-card');
        if (card) {
            card.style.boxShadow = '';
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
        // Simplified: No overlay animation, the card fly-out is enough feedback
        // Just provide haptic feedback if available
        if (navigator.vibrate) {
            navigator.vibrate(direction === 'YES' ? [30, 20, 30] : [50]);
        }
    }

    reset() {
        this.startX = 0;
        this.startY = 0;
        this.endX = 0;
        this.endY = 0;
    }
}

// Initialize swipe gestures for Quick Play card screen ONLY
function initSwipeGestures() {
    // Cleanup any leftover indicator elements from old code
    document.getElementById('swipe-indicator')?.remove();
    document.querySelectorAll('.stake-success-animation').forEach(el => el.parentElement?.remove());
    
    // Only attach to the Quick Play card container - NOT pledge pool
    const quickPlayCard = document.getElementById('quick-play-card');
    
    if (quickPlayCard) {
        const swipeHandler = new SwipeGestureHandler();
        swipeHandler.init(quickPlayCard);
        console.log('✨ Swipe gestures initialized for Quick Play card');
    } else {
        console.log('⚠️ Quick Play card not found for swipe gestures');
    }
}

// Export
window.SwipeGestureHandler = SwipeGestureHandler;
window.initSwipeGestures = initSwipeGestures;
