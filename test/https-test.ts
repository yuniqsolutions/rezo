import * as https from 'https';
import { SocksHttps } from './socks';

const proxyUrl = 'socks5://DVSitKmJ1p:s8bQ8k@78.46.24.187:56424';
const agent = new SocksHttps(proxyUrl);

const options = {
    hostname: 'httpbin.org',
    port: 443,
    path: '/ip',
    method: 'GET',
    agent: agent
};

console.log('Testing HTTPS with SOCKS proxy using SocksHttps agent...');

const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);

    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('Response:', data);
    });
});

req.on('error', (err: any) => {
    console.error('Request error:', err);
    console.error('Error code:', err.code);
    console.error('Error message:', err.message);
    console.error('Stack trace:', err.stack);
});

req.end();
