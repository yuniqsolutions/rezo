import * as http from 'node:http';
import * as https from 'node:https';
import { SocksProxyAgent, SocksProxyHttpsAgent } from './socks';

// Test upstream agent functionality
async function testUpstreamAgent() {
    console.log('Testing upstreamAgent functionality...\n');

    // Create a simple HTTP upstream agent
    const httpUpstreamAgent = new http.Agent({
        keepAlive: true,
        maxSockets: 10
    });

    // Create a simple HTTPS upstream agent
    const httpsUpstreamAgent = new https.Agent({
        keepAlive: true,
        maxSockets: 10,
        rejectUnauthorized: false
    });

    // Test 1: HTTP SOCKS agent with HTTP upstream agent
    console.log('Test 1: HTTP SOCKS agent with HTTP upstream agent');
    try {
        const proxy = 'socks5://test:test@127.0.0.1:1080';
        const httpSocksAgent = new SocksProxyAgent(proxy, {
            upstreamAgent: httpUpstreamAgent,
            timeout: 5000
        });
        
        console.log('✓ HTTP SOCKS agent created successfully with HTTP upstream agent');
        console.log(`  - Upstream agent type: ${httpSocksAgent.upstreamAgent?.constructor.name}`);
        console.log(`  - Has createConnection: ${typeof httpSocksAgent.upstreamAgent?.createConnection === 'function'}`);
    } catch (error) {
        console.log('✗ Failed to create HTTP SOCKS agent with HTTP upstream agent:', error);
    }

    // Test 2: HTTP SOCKS agent with HTTPS upstream agent
    console.log('\nTest 2: HTTP SOCKS agent with HTTPS upstream agent');
    try {
        const proxy = 'socks5://test:test@127.0.0.1:1080';
        const httpSocksAgent = new SocksProxyAgent(proxy, {
            upstreamAgent: httpsUpstreamAgent,
            timeout: 5000
        });
        
        console.log('✓ HTTP SOCKS agent created successfully with HTTPS upstream agent');
        console.log(`  - Upstream agent type: ${httpSocksAgent.upstreamAgent?.constructor.name}`);
        console.log(`  - Has createConnection: ${typeof httpSocksAgent.upstreamAgent?.createConnection === 'function'}`);
    } catch (error) {
        console.log('✗ Failed to create HTTP SOCKS agent with HTTPS upstream agent:', error);
    }

    // Test 3: HTTPS SOCKS agent with HTTP upstream agent
    console.log('\nTest 3: HTTPS SOCKS agent with HTTP upstream agent');
    try {
        const proxy = 'socks5://test:test@127.0.0.1:1080';
        const httpsSocksAgent = new SocksProxyHttpsAgent(proxy, {
            upstreamAgent: httpUpstreamAgent,
            timeout: 5000
        });
        
        console.log('✓ HTTPS SOCKS agent created successfully with HTTP upstream agent');
        console.log(`  - Upstream agent type: ${httpsSocksAgent.upstreamAgent?.constructor.name}`);
        console.log(`  - Has createConnection: ${typeof httpsSocksAgent.upstreamAgent?.createConnection === 'function'}`);
    } catch (error) {
        console.log('✗ Failed to create HTTPS SOCKS agent with HTTP upstream agent:', error);
    }

    // Test 4: HTTPS SOCKS agent with HTTPS upstream agent
    console.log('\nTest 4: HTTPS SOCKS agent with HTTPS upstream agent');
    try {
        const proxy = 'socks5://test:test@127.0.0.1:1080';
        const httpsSocksAgent = new SocksProxyHttpsAgent(proxy, {
            upstreamAgent: httpsUpstreamAgent,
            timeout: 5000
        });
        
        console.log('✓ HTTPS SOCKS agent created successfully with HTTPS upstream agent');
        console.log(`  - Upstream agent type: ${httpsSocksAgent.upstreamAgent?.constructor.name}`);
        console.log(`  - Has createConnection: ${typeof httpsSocksAgent.upstreamAgent?.createConnection === 'function'}`);
    } catch (error) {
        console.log('✗ Failed to create HTTPS SOCKS agent with HTTPS upstream agent:', error);
    }

    // Test 5: Test with HttpsCookieAgent (similar to your use case)
    console.log('\nTest 5: Testing with third-party HTTPS agent (simulated)');
    try {
        // Simulate HttpsCookieAgent structure
        class MockHttpsCookieAgent extends https.Agent {
            constructor(options: any) {
                super(options);
            }
        }

        const mockCookieAgent = new MockHttpsCookieAgent({
            keepAlive: true,
            rejectUnauthorized: false
        });

        const proxy = 'socks5://test:test@127.0.0.1:1080';
        const httpsSocksAgent = new SocksProxyHttpsAgent(proxy, {
            upstreamAgent: mockCookieAgent,
            timeout: 5000
        });
        
        console.log('✓ HTTPS SOCKS agent created successfully with mock cookie agent');
        console.log(`  - Upstream agent type: ${httpsSocksAgent.upstreamAgent?.constructor.name}`);
        console.log(`  - Has createConnection: ${typeof httpsSocksAgent.upstreamAgent?.createConnection === 'function'}`);
    } catch (error) {
        console.log('✗ Failed to create HTTPS SOCKS agent with mock cookie agent:', error);
    }

    console.log('\nUpstream agent tests completed!');
}

// Run the test
testUpstreamAgent().catch(console.error);