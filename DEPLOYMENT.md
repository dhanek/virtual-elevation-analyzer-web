# Deployment

## Production deployment target

The app is deployed as a static site on GitHub Pages:

- Live URL: https://dhanek.github.io/virtual-elevation-analyzer-web/
- Workflow: `.github/workflows/deploy.yml`
- Trigger: pushes to `main` and manual `workflow_dispatch`

## CI pipeline

The deploy workflow builds and validates the project in this order:

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm ci
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

The frontend build runs with:

```bash
VITE_GITHUB_PAGES=true
```

so Vite emits the correct GitHub Pages base path.

## Local deployment parity

Run the same sequence locally before shipping changes:

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm ci
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

The output is written to `dist/`.

## Local development

For normal development you usually only need:

```bash
cd frontend && npm install
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run dev
```

Or use the project build helper:

```bash
./build.sh
```

## GitHub Pages setup

In the repository settings:

1. Open **Settings → Pages**
2. Set **Build and deployment → Source** to **GitHub Actions**

After that, pushes to `main` will publish the newest successful build.

## Troubleshooting

### CI fails during frontend type/lint/test/build

Re-run the local parity commands and fix the first failing step before pushing.

### CI fails because the WASM package is missing

Make sure the workflow or local build runs:

```bash
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
```

before any frontend check/build step.

### The deployed site loads but assets are broken

Check that `VITE_GITHUB_PAGES=true` was set during the production frontend build.
