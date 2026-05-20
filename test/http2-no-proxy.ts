import rezo from '../src/core/rezo';

async function testHttp2WithoutProxy() {
  try {
    
    const response = await rezo.get('https://www.google.com', { http2: true });
    console.log('HTTP/2 config:', response.config.http2);
    console.log('HTTP Version:', response.httpVersion);
    console.log('URL:', response.config.url);
    console.log('Status Code:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers));
    console.log('Headers2:', response.headers);
    console.log('Status: Success');
  } catch (error) {
    console.error('Error:', error);
  }
}

testHttp2WithoutProxy();