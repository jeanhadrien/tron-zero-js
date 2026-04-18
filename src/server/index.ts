import './setup.ts';

// By dynamically importing or delaying the import of main, we ensure setup runs first.
// However, bun evaluates both statically if we just `import './main.ts'`.
// Using `require` or dynamic import is safer.
async function boot() {
    await import('./main.ts');
}

boot();