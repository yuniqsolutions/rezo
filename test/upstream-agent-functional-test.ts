import * as https from 'node:https';
import { SocksProxyHttpsAgent } from './socks';

// Create a mock upstream agent that logs when createConnection is called
class MockUpstreamAgent extends https.Agent {
    public createConnectionCalled = false;
    public createConnectionArgs: any[] = [];

    constructor(options: any = {}) {
        super(options);
    }

    createConnection(options: any, callback?: any): any {
        console.log('🔍 MockUpstreamAgent.createConnection called!');
        console.log('   Options:', JSON.stringify(options, null, 2));
        
        this.createConnectionCalled = true;
        this.createConnectionArgs.push(options);
        
        // Call the original createConnection method
        return super.createConnection(options, callback);
    }
}

async function testUpstreamAgentFunctionality() {
    console.log('Testing upstreamAgent functional behavior...\n');

    // Create mock upstream agent
    const mockUpstreamAgent = new MockUpstreamAgent({
        keepAlive: true,
        rejectUnauthorized: false
    });

    // Create SOCKS agent with mock upstream agent
    const proxy = 'socks5://test:test@127.0.0.1:1080'; // This will likely fail, but that's OK
    const socksAgent = new SocksProxyHttpsAgent(proxy, {
        upstreamAgent: mockUpstreamAgent,
        timeout: 2000 // Short timeout to fail quickly
    });

    console.log('✓ SOCKS agent created with mock upstream agent');
    console.log(`  - Upstream agent type: ${socksAgent.upstreamAgent?.constructor.name}`);

    // Try to create a connection (this will likely fail, but we want to see if upstreamAgent is called)
    console.log('\n🚀 Attempting to create connection...');
    
    try {
        const socket = socksAgent.createConnection({
            host: 'httpbin.org',
            port: 443,
            protocol: 'https:'
        });

        // Wait a bit to see if the upstream agent gets called
        await new Promise(resolve => setTimeout(resolve, 3000));
        
    } catch (error: any) {
        console.log('Expected error occurred:', error.message);
    }

    // Check if upstream agent was called
    console.log('\n📊 Results:');
    console.log(`  - createConnection called on upstream agent: ${mockUpstreamAgent.createConnectionCalled}`);
    console.log(`  - Number of calls: ${mockUpstreamAgent.createConnectionArgs.length}`);
    
    if (mockUpstreamAgent.createConnectionCalled) {
        console.log('  - Call arguments:');
        mockUpstreamAgent.createConnectionArgs.forEach((args, index) => {
            console.log(`    Call ${index + 1}:`, JSON.stringify(args, null, 6));
        });
    }

    if (mockUpstreamAgent.createConnectionCalled) {
        console.log('\n✅ SUCCESS: upstreamAgent.createConnection was called!');
        console.log('   This confirms that the upstreamAgent functionality is working correctly.');
    } else {
        console.log('\n❌ ISSUE: upstreamAgent.createConnection was NOT called.');
        console.log('   This suggests there might be an issue with the upstreamAgent implementation.');
    }
}

// Run the test
testUpstreamAgentFunctionality().catch(console.error);