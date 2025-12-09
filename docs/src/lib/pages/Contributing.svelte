<script lang="ts">
  import CodeBlock from '../components/CodeBlock.svelte';

  const setup = `# Clone the repository
git clone https://github.com/user/rezo.git
cd rezo

# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build`;
</script>

<svelte:head>
  <title>Contributing - Rezo Documentation</title>
</svelte:head>

<div class="space-y-12">
  <header>
    <h1 class="text-3xl sm:text-4xl font-bold mb-4">Contributing</h1>
    <p class="text-lg" style="color: var(--muted);">
      Help improve Rezo! We welcome contributions of all kinds.
    </p>
  </header>

  <section>
    <h2 class="text-2xl font-bold mb-4">Ways to Contribute</h2>
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h3 class="font-semibold mb-2">Report Bugs</h3>
        <p class="text-sm" style="color: var(--muted);">
          Found a bug? Open an issue on GitHub with steps to reproduce.
        </p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h3 class="font-semibold mb-2">Request Features</h3>
        <p class="text-sm" style="color: var(--muted);">
          Have an idea? Open a feature request and describe your use case.
        </p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h3 class="font-semibold mb-2">Improve Docs</h3>
        <p class="text-sm" style="color: var(--muted);">
          Fix typos, add examples, or improve explanations.
        </p>
      </div>
      <div class="p-4 rounded-lg" style="background-color: var(--surface);">
        <h3 class="font-semibold mb-2">Submit PRs</h3>
        <p class="text-sm" style="color: var(--muted);">
          Fix bugs or implement new features with pull requests.
        </p>
      </div>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Development Setup</h2>
    <CodeBlock code={setup} language="bash" />
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Report Issues</h2>
    <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);">
      <p class="mb-4" style="color: var(--muted);">
        Found a bug or have a feature request? Let us know!
      </p>
      <a 
        href="https://github.com/user/rezo/issues/new" 
        target="_blank"
        rel="noopener"
        class="gradient-bg text-white px-4 py-2 rounded-lg font-medium inline-block hover:opacity-90 transition-opacity"
      >
        Open an Issue on GitHub
      </a>
    </div>
  </section>

  <section>
    <h2 class="text-2xl font-bold mb-4">Code of Conduct</h2>
    <p style="color: var(--muted);">
      We are committed to providing a welcoming and inclusive environment. 
      Please read and follow our Code of Conduct when participating in this project.
    </p>
  </section>
</div>
