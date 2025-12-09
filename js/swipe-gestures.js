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
        this.hasMoved = false;
        this.minSwipeDistance = 50;
        this.activeElement = null;
        this.boundHandlers = {};
    }

    init(element) {
        if (!element) return;

        // Create bound handlers for proper removal
        this.boundHandlers = {
            touchStart: (e) => this.handleTouchStart(e),
            touchMove: (e) => this.handleTouchMove(e),
            touchEnd: (e) => this.handleTouchEnd(e),
            mouseDown: (e) => this.handleMouseDown(e),
            mouseMove: (e) => this.handleMouseMove(e),
            mouseUp: (e) => this.handleMouseUp(e)
        };

        element.addEventListener('touchstart', this.boundHandlers.touchStart, { passive: true });
        element.addEventListener('touchmove', this.boundHandlers.touchMove, { passive: false });
        element.addEventListener('touchend', this.boundHandlers.touchEnd, { passive: true });

        // Mouse support for desktop
        element.addEventListener('mousedown', this.boundHandlers.mouseDown);
        element.addEventListener('mousemove', this.boundHandlers.mouseMove);
        element.addEventListener('mouseup', this.boundHandlers.mouseUp);

        this.activeElement = element;
    }

    destroy() {
        if (this.activeElement && this.boundHandlers.touchStart) {
            this.activeElement.removeEventListener('touchstart', this.boundHandlers.touchStart);
            this.activeElement.removeEventListener('touchmove', this.boundHandlers.touchMove);
            this.activeElement.removeEventListener('touchend', this.boundHandlers.touchEnd);
            this.activeElement.removeEventListener('mousedown', this.boundHandlers.mouseDown);
            this.activeElement.removeEventListener('mousemove', this.boundHandlers.mouseMove);
            this.activeElement.removeEventListener('mouseup', this.boundHandlers.mouseUp);
        }
        this.activeElement = null;
        this.boundHandlers = {};
    }

    handleTouchStart(e) {
        this.startX = e.touches[0].clientX;
        this.startY = e.touches[0].clientY;
        this.endX = this.startX;
        this.endY = this.startY;
        this.hasMoved = false;
    }

    handleTouchMove(e) {
        if (!this.startX || !this.startY) return;

        this.endX = e.touches[0].clientX;
        this.endY = e.touches[0].clientY;
        this.hasMoved = true;

        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;

        // Visual feedback during swipe
        if (Math.abs(diffX) > 20) {
            this.showSwipeIndicator(diffX > 0 ? 'YES' : 'NO', Math.abs(diffX));
        }
    }

    handleTouchEnd(e) {
        // Use changedTouches for accurate end position
        if (e.changedTouches && e.changedTouches[0]) {
            this.endX = e.changedTouches[0].clientX;
            this.endY = e.changedTouches[0].clientY;
        }

        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;

        // Only trigger swipe if user actually moved (not just a tap)
        if (this.hasMoved && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.minSwipeDistance) {
            const direction = diffX > 0 ? 'YES' : 'NO';
            this.triggerStake(direction);
        }

        this.hideSwipeIndicator();
        this.reset();
    }

    handleMouseDown(e) {
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.endX = this.startX;
        this.endY = this.startY;
        this.hasMoved = false;
        if (this.activeElement) {
            this.activeElement.style.cursor = 'grabbing';
        }
    }

    handleMouseMove(e) {
        if (!this.startX) return;

        this.endX = e.clientX;
        this.endY = e.clientY;
        this.hasMoved = true;

        const diffX = this.endX - this.startX;

        if (Math.abs(diffX) > 20) {
            this.showSwipeIndicator(diffX > 0 ? 'YES' : 'NO', Math.abs(diffX));
        }
    }

    handleMouseUp(e) {
        // Get final position from mouse event
        this.endX = e.clientX;
        this.endY = e.clientY;

        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;

        // Only trigger swipe if user actually moved (not just a click)
        if (this.hasMoved && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.minSwipeDistance) {
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
        this.hasMoved = false;
    }
}

// Singleton swipe handler instance
let currentSwipeHandler = null;

// Initialize swipe gestures for Quick Play card screen ONLY
function initSwipeGestures() {
    // Cleanup any leftover indicator elements from old code
    document.getElementById('swipe-indicator')?.remove();
    document.querySelectorAll('.stake-success-animation').forEach(el => el.parentElement?.remove());
    
    // Destroy existing handler to prevent duplicate listeners
    if (currentSwipeHandler) {
        currentSwipeHandler.destroy();
        currentSwipeHandler = null;
    }
    
    // Only attach to the Quick Play card container - NOT pledge pool
    const quickPlayCard = document.getElementById('quick-play-card');
    
    if (quickPlayCard) {
        currentSwipeHandler = new SwipeGestureHandler();
        currentSwipeHandler.init(quickPlayCard);
        console.log('✨ Swipe gestures initialized for Quick Play card');
    } else {
        console.log('⚠️ Quick Play card not found for swipe gestures');
    }
}

// Export
window.SwipeGestureHandler = SwipeGestureHandler;
window.initSwipeGestures = initSwipeGestures;
