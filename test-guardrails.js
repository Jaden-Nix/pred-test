import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';

// Demo auth token (you'll need a valid Firebase token in production)
const AUTH_TOKEN = 'demo-token';

async function testGuardrail(testName, content) {
    console.log(`\n🧪 Test: ${testName}`);
    console.log(`Content: "${content}"`);
    
    try {
        const response = await fetch(`${BASE_URL}/api/moderate-content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AUTH_TOKEN}`
            },
            body: JSON.stringify({
                content: content,
                contentType: 'comment'
            })
        });
        
        const result = await response.json();
        console.log(`✅ Result:`, JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.log(`❌ Error:`, error.message);
    }
}

async function runTests() {
    console.log('🛡️  AI GUARDRAILS TEST SUITE');
    console.log('=' .repeat(50));
    
    // Test 1: Normal content (should pass)
    await testGuardrail(
        'Normal comment',
        'I think Bitcoin will reach $100k by next month'
    );
    
    // Test 2: Content too short (pre-filter catch)
    await testGuardrail(
        'Content too short',
        'No'
    );
    
    // Test 3: Excessive repetition (pre-filter catch)
    await testGuardrail(
        'Excessive repetition',
        'This is boring aaaaaaaaaaaaaaa'
    );
    
    // Test 4: Too many links (pre-filter catch)
    await testGuardrail(
        'Too many links',
        'Check these: https://test1.com https://test2.com https://test3.com https://test4.com https://test5.com https://test6.com'
    );
    
    // Test 5: Excessive capitalization (pre-filter catch)
    await testGuardrail(
        'Excessive capitalization',
        'THIS IS REALLY REALLY IMPORTANT MESSAGE THAT IS VERY LOUD AND ANGRY'
    );
    
    // Test 6: Blocked keyword (blocklist catch)
    await testGuardrail(
        'Blocked keyword - hate speech',
        'I hate all people who disagree with me'
    );
    
    // Test 7: Another blocked keyword
    await testGuardrail(
        'Blocked keyword - violence',
        'Someone should kill all the traders'
    );
    
    // Test 8: Suspicious but legitimate
    await testGuardrail(
        'Legitimate discussion',
        'This market resolution seems questionable. I think we need to review the evidence more carefully before making a decision.'
    );
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Test suite complete!');
}

runTests().catch(console.error);
