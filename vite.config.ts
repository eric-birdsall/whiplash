import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/ and as a plain static folder.
export default defineConfig({ base: './' });
