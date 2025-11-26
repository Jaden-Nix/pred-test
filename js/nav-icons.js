/**
 * MODERN NAVIGATION ICONS
 * Sleek, animated navigation with better UX
 */

// Modern icon set with animations
const modernNavIcons = {
    home: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" 
                  stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    trending: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    quickPlay: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    create: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    social: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" 
                  stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    copyTrade: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" 
                  stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    profile: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
                  stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    notifications: `
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" 
                  stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `
};

// Update navigation with modern icons
function updateNavigationIcons() {
    // Don't rewrite the navigation - just enhance existing icons with animations
    // The existing navigation uses Lucide icons which are already loaded
    console.log('📱 Navigation enhancement skipped - using existing Lucide icons');
    
    // Just add activity indicators to existing nav buttons
    const navButtons = document.querySelectorAll('[data-screen]');
    navButtons.forEach(btn => {
        // Enhance hover effects
        btn.classList.add('transition-all', 'duration-300');
    });
}

// Add activity indicator to nav icon
function addNavActivityIndicator(screenId) {
    const navItem = document.querySelector(`[data-screen="${screenId}"]`);
    if (navItem) {
        const dot = navItem.querySelector('.activity-dot');
        if (dot) {
            dot.classList.remove('hidden');
            setTimeout(() => dot.classList.add('hidden'), 5000);
        }
    }
}

// Highlight active nav item
function updateActiveNav(activeScreen) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.dataset.screen === activeScreen) {
            item.classList.add('nav-active');
            item.classList.remove('nav-inactive');
            item.querySelector('.nav-label')?.classList.replace('text-gray-400', 'text-sky-400');
        } else {
            item.classList.remove('nav-active');
            item.classList.add('nav-inactive');
            item.querySelector('.nav-label')?.classList.replace('text-sky-400', 'text-gray-400');
        }
    });
}

// Add CSS for modern nav
const navStyles = `
    <style>
        .nav-icon {
            width: 24px;
            height: 24px;
            transition: all 0.3s ease;
        }
        
        .nav-item:hover .nav-icon {
            transform: scale(1.1);
            filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.5));
        }
        
        .nav-active .nav-icon {
            stroke: #38bdf8;
            transform: scale(1.15);
            filter: drop-shadow(0 0 12px rgba(56, 189, 248, 0.8));
        }
        
        .nav-item {
            position: relative;
        }
        
        .nav-active::before {
            content: '';
            position: absolute;
            top: -4px;
            left: 50%;
            transform: translateX(-50%);
            width: 32px;
            height: 3px;
            background: linear-gradient(90deg, #38bdf8, #818cf8);
            border-radius: 0 0 4px 4px;
        }
        
        .modern-nav-bar {
            backdrop-filter: blur(20px);
            box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.1);
        }
    </style>
`;

// Inject nav styles
if (!document.getElementById('modern-nav-styles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'modern-nav-styles';
    styleElement.innerHTML = navStyles;
    document.head.appendChild(styleElement);
}

// Export functions
window.updateNavigationIcons = updateNavigationIcons;
window.addNavActivityIndicator = addNavActivityIndicator;
window.updateActiveNav = updateActiveNav;
window.modernNavIcons = modernNavIcons;
