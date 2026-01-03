// Test script to check extension connection and registration status
// Run with: node test-connection.js

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000/api/v1';

async function testConnection() {
  console.log('🔍 Testing AI Chat Bridge Connection...\n');
  
  // 1. Health check
  console.log('1. Health Check:');
  try {
    const health = await fetch(`${API_BASE}/health`);
    const healthData = await health.json();
    console.log('   ✅', JSON.stringify(healthData, null, 2));
  } catch (error) {
    console.log('   ❌ Error:', error.message);
    return;
  }
  
  // 2. Check extensions
  console.log('\n2. Connected Extensions:');
  try {
    const extensions = await fetch(`${API_BASE}/extensions`);
    const extData = await extensions.json();
    console.log('   Extensions:', extData.extensions.length);
    console.log('   Connected:', extData.connected);
    if (extData.extensions.length > 0) {
      extData.extensions.forEach(ext => {
        console.log(`   - ${ext.id.substring(0, 8)}... (ready: ${ext.ready}, state: ${ext.state})`);
      });
    } else {
      console.log('   ⚠️  No extensions connected!');
      console.log('   → Make sure extension is loaded and backend client is connected');
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  // 3. Test chat (will fail if no session registered)
  console.log('\n3. Test Chat Request:');
  try {
    const chat = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'ai-chat-bridge-extension',
        messages: [{ role: 'user', content: 'Hello, test message' }]
      })
    });
    
    const chatData = await chat.json();
    
    if (chat.status === 200) {
      console.log('   ✅ Success!');
      console.log('   Response:', chatData.choices[0].message.content.substring(0, 100) + '...');
    } else {
      console.log(`   ❌ Error ${chat.status}:`, JSON.stringify(chatData, null, 2));
      if (chat.status === 503) {
        console.log('\n   💡 Troubleshooting:');
        console.log('   1. Open Chrome → chrome://extensions/');
        console.log('   2. Find "AI Chat Bridge" and click Reload');
        console.log('   3. Open a Gemini or ChatGPT tab');
        console.log('   4. Click "Register as Agent A" or "Register as Agent B"');
        console.log('   5. Check Side Panel → Backend badge should be green');
        console.log('   6. Run this test again');
      }
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
  
  console.log('\n✅ Test completed!\n');
}

testConnection().catch(console.error);

