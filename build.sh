#!/bin/bash

# Build script for Virtual Elevation Analyzer
# Following README.md Phase 6 deployment guidelines

set -e

echo "🏗️  Building Virtual Elevation Analyzer..."

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack is not installed. Please install it first:"
    echo "   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js and npm first."
    exit 1
fi

echo "📦 Building Rust/WebAssembly backend..."
cd backend
wasm-pack build --target web --out-dir ../frontend/pkg
cd ..

echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

echo "🏗️  Building frontend..."
cd frontend
npm run build
cd ..

echo "✅ Build completed successfully!"
echo "📁 Static files are ready in: ./dist/"
echo "🚀 To serve locally: cd dist && python -m http.server 8000"