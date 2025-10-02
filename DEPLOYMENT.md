# GitHub Pages Deployment Guide

## Files Created

1. **`.github/workflows/deploy.yml`** - GitHub Actions workflow for automatic deployment
2. **`.gitignore`** - Proper ignore patterns for Rust/WASM/Node.js project
3. **`vite.config.ts`** - Updated with correct base path for GitHub Pages

## Setup Steps

### 1. Enable GitHub Pages

1. Go to your repository: https://github.com/dhanek/virtual-elevation-analyzer-web
2. Click **Settings** → **Pages**
3. Under "Build and deployment":
   - **Source**: Select "GitHub Actions"

### 2. Commit and Push

```bash
# Stage the new files
git add .github/ .gitignore frontend/vite.config.ts DEPLOYMENT.md

# Commit
git commit -m "Add GitHub Pages deployment workflow"

# Push to trigger deployment
git push origin main
```

### 3. Monitor Deployment

- Go to the **Actions** tab in your repository
- Watch the "Deploy to GitHub Pages" workflow run
- Once complete (usually 2-3 minutes), your app will be live

### 4. Access Your Deployed App

Your app will be available at:
**https://dhanek.github.io/virtual-elevation-analyzer-web/**

## Local Development

The deployment doesn't affect local development. Continue using:

```bash
# Build WASM
cd backend
wasm-pack build --target web --out-dir ../frontend/pkg

# Run dev server
cd ../frontend
npm run dev
```

## Troubleshooting

### If deployment fails:

1. Check the Actions tab for error logs
2. Ensure all dependencies are in `package.json`
3. Verify WASM builds locally before pushing

### If app loads but doesn't work:

1. Check browser console for errors
2. Verify WASM files are in the deployed `pkg/` folder
3. Check that base path is correct in `vite.config.ts`

## Project Structure

```
virtual-elevation-analyzer-web/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions workflow
├── backend/                    # Rust/WASM code
│   ├── src/
│   └── Cargo.toml
├── frontend/                   # TypeScript/Vite frontend
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts         # Vite config with base path
├── dist/                       # Build output (gitignored)
└── .gitignore                 # Ignore patterns
```

## Notes

- The workflow automatically builds both Rust/WASM and frontend on every push to `main`
- WASM files are bundled into the deployment
- The app uses relative paths for all assets
- No server-side code is needed - it's a static site
