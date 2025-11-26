#!/usr/bin/env node
/**
 * Predora Oracle Cron Job
 * Runs automatically via Replit Scheduled Deployment
 * Calls the /api/run-jobs endpoint to trigger market resolution, poll auto-resolution, etc.
 */

const CRON_SECRET = process.env.CRON_SECRET || 'predora-oracle-secret-2025';
const APP_URL = process.env.REPLIT_DEVSERVER_URL || 'http://localhost:5000';

async function runOracleSweep() {
    try {
        console.log(`⏰ Oracle cron job started at ${new Date().toISOString()}`);
        console.log(`🔗 Calling: ${APP_URL}/api/run-jobs`);
        
        const response = await fetch(`${APP_URL}/api/run-jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                key: CRON_SECRET
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            console.log('✅ Oracle jobs completed successfully');
            console.log('📊 Response:', data);
            process.exit(0);
        } else {
            console.error('❌ Oracle jobs failed');
            console.error('📊 Response:', data);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error running oracle cron job:', error.message);
        process.exit(1);
    }
}

runOracleSweep();
