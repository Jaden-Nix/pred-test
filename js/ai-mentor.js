/**
 * AI MARKET MENTOR
 * Conversational AI coach powered by Gemini that helps users make better predictions
 */

let mentorActive = false;
let mentorChatHistory = [];

// Start AI Mentor conversation
async function startMentor() {
    if (!window.currentUser) {
        showToast('Please sign in to use the AI Mentor', 'info');
        return;
    }
    
    mentorActive = true;
    showMentorUI();
    
    // Welcome message
    addMentorMessage('ai', 'Hello! I\'m your AI Market Mentor 🤖. I can help you:\n\n• Analyze market trends and odds\n• Suggest winning strategies\n• Explain prediction concepts\n• Review your portfolio\n\nWhat would you like to know?');
}

// Show mentor chat UI
function showMentorUI() {
    // Check if UI already exists
    if (document.getElementById('mentor-modal')) return;
    
    const modal = document.createElement('div');
    modal.id = 'mentor-modal';
    modal.className = 'fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm animate-fadeIn';
    modal.innerHTML = `
        <div class="w-full md:w-[500px] h-[600px] md:h-[700px] bg-gradient-to-br from-gray-900 to-gray-800 md:rounded-2xl shadow-2xl flex flex-col animate-slideUp md:animate-scaleIn">
            <!-- Header -->
            <div class="flex items-center justify-between p-4 border-b border-white/10">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                        <span class="text-2xl">🤖</span>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-white">AI Market Mentor</h3>
                        <p class="text-xs text-gray-400">Powered by Gemini AI</p>
                    </div>
                </div>
                <button onclick="closeMentor()" class="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            
            <!-- Quick Actions -->
            <div class="p-3 border-b border-white/10 flex gap-2 overflow-x-auto">
                <button onclick="askMentor('Analyze current trending markets')" class="px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 text-sm rounded-full whitespace-nowrap transition-colors">
                    📊 Analyze Markets
                </button>
                <button onclick="askMentor('What is my current win rate and how can I improve?')" class="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-sm rounded-full whitespace-nowrap transition-colors">
                    📈 My Stats
                </button>
                <button onclick="askMentor('Give me a winning strategy for sports markets')" class="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm rounded-full whitespace-nowrap transition-colors">
                    💡 Strategies
                </button>
            </div>
            
            <!-- Chat Messages -->
            <div id="mentor-messages" class="flex-1 overflow-y-auto p-4 space-y-4">
            </div>
            
            <!-- Input -->
            <div class="p-4 border-t border-white/10">
                <div class="flex gap-2">
                    <input 
                        id="mentor-input" 
                        type="text" 
                        placeholder="Ask me anything about predictions..."
                        class="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-sky-500 transition-colors"
                        onkeypress="if(event.key==='Enter') sendMentorMessage()"
                    />
                    <button 
                        onclick="sendMentorMessage()" 
                        class="px-6 py-3 bg-gradient-to-r from-sky-500 to-indigo-600 text-white rounded-xl font-semibold hover:shadow-lg hover:scale-105 transition-all duration-200"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus input
    setTimeout(() => {
        document.getElementById('mentor-input')?.focus();
    }, 300);
}

// Close mentor
function closeMentor() {
    const modal = document.getElementById('mentor-modal');
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 300);
    }
    mentorActive = false;
}

// Add message to chat
function addMentorMessage(role, content) {
    const messagesContainer = document.getElementById('mentor-messages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'} animate-slideIn`;
    
    if (role === 'ai') {
        messageDiv.innerHTML = `
            <div class="max-w-[80%] bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-2xl rounded-tl-sm p-4">
                <div class="flex items-start gap-2 mb-2">
                    <span class="text-xl">🤖</span>
                    <span class="text-xs font-semibold text-purple-400">AI Mentor</span>
                </div>
                <p class="text-white text-sm leading-relaxed whitespace-pre-wrap">${content}</p>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="max-w-[80%] bg-sky-500/20 border border-sky-500/30 rounded-2xl rounded-tr-sm p-4">
                <p class="text-white text-sm leading-relaxed">${content}</p>
            </div>
        `;
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send user message
async function sendMentorMessage() {
    const input = document.getElementById('mentor-input');
    if (!input || !input.value.trim()) return;
    
    const message = input.value.trim();
    input.value = '';
    
    // Add user message
    addMentorMessage('user', message);
    
    // Show typing indicator
    showTypingIndicator();
    
    // Get AI response
    await askMentor(message);
}

// Ask mentor a question
async function askMentor(question) {
    try {
        // Remove typing indicator
        removeTypingIndicator();
        
        // Build context about user
        const userContext = await getUserContext();
        
        // Call AI assistant endpoint
        const response = await fetch('/api/ai-assistant', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await window.currentUser?.getIdToken()}`
            },
            body: JSON.stringify({
                prompt: `You are the AI Market Mentor for Predora, a prediction market platform. 
                
User Context:
${userContext}

User Question: ${question}

Provide helpful, concise advice about prediction markets, strategies, and analysis. Be encouraging and educational. Use emojis sparingly for clarity. Keep responses under 150 words.`,
                context: mentorChatHistory
            })
        });
        
        if (!response.ok) {
            throw new Error('AI service unavailable');
        }
        
        const data = await response.json();
        const aiResponse = data.response || 'I\'m having trouble thinking right now. Please try again!';
        
        // Add AI response
        addMentorMessage('ai', aiResponse);
        
        // Update chat history
        mentorChatHistory.push({ role: 'user', content: question });
        mentorChatHistory.push({ role: 'assistant', content: aiResponse });
        
        // Keep only last 10 messages
        if (mentorChatHistory.length > 10) {
            mentorChatHistory = mentorChatHistory.slice(-10);
        }
        
    } catch (error) {
        console.error('Mentor error:', error);
        removeTypingIndicator();
        addMentorMessage('ai', '❌ Sorry, I\'m having trouble connecting. Please try again!');
    }
}

// Get user context for personalized responses
async function getUserContext() {
    const profile = window.userProfile || {};
    const xp = profile.xp || 0;
    const displayName = profile.displayName || 'Predictor';
    
    return `
- Name: ${displayName}
- XP Level: ${xp}
- Predictions Made: ${profile.totalPredictions || 0}
- Win Rate: ${profile.winRate || 0}%
- Current Streak: ${profile.streak || 0} days
`;
}

// Show typing indicator
function showTypingIndicator() {
    const messagesContainer = document.getElementById('mentor-messages');
    if (!messagesContainer) return;
    
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'flex justify-start';
    indicator.innerHTML = `
        <div class="bg-purple-500/20 border border-purple-500/30 rounded-2xl rounded-tl-sm px-5 py-3">
            <div class="flex gap-1.5">
                <div class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
                <div class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
                <div class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(indicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Remove typing indicator
function removeTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
}

// Export functions
window.startMentor = startMentor;
window.closeMentor = closeMentor;
window.askMentor = askMentor;
window.sendMentorMessage = sendMentorMessage;

console.log('🤖 AI Market Mentor loaded!');
