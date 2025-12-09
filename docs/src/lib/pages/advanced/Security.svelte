<script lang="ts">
  import CodeBlock from '../../components/CodeBlock.svelte';

  const tlsConfig = `// Custom CA certificate
await rezo.get('https://internal-api.company.com', {
  ca: fs.readFileSync('./certs/internal-ca.pem')
});

// Client certificate authentication
await rezo.get('https://mtls-api.example.com', {
  cert: fs.readFileSync('./certs/client.pem'),
  key: fs.readFileSync('./certs/client-key.pem'),
  passphrase: 'key-password'  // If key is encrypted
});

// Skip certificate validation (not for production!)
await rezo.get('https://self-signed.example.com', {
  rejectUnauthorized: false
});`;

  const certificatePinning = `// Certificate pinning
await rezo.get('https://api.example.com', {
  checkServerIdentity: (host, cert) => {
    // Verify certificate fingerprint
    const fingerprint = cert.fingerprint256;
    const expected = 'AA:BB:CC:DD:EE:FF:...';
    
    if (fingerprint !== expected) {
      throw new Error('Certificate fingerprint mismatch');
    }
  }
});`;

  const secureDefaults = `// Rezo uses secure defaults
// - rejectUnauthorized: true (validates certificates)
// - TLS 1.2+ required
// - Secure cipher suites

// To customize TLS settings
await rezo.get('https://api.example.com', {
  secureOptions: require('constants').SSL_OP_NO_TLSv1,
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:!aNULL:!MD5'
});`;
</script>

<svelte:head>
  <title>Security Best Practices - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">TLS & Security</h1>
    <p class="text-lg" style="color: var(--muted);">
      Comprehensive TLS configuration, certificate management, and security best practices.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">TLS Configuration</h2>
    <CodeBlock code={tlsConfig} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Certificate Pinning</h2>
    <CodeBlock code={certificatePinning} language="typescript" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Secure Defaults</h2>
    <CodeBlock code={secureDefaults} language="typescript" />
  </section>
</div>
