#!/bin/bash

# Better Auto PiP - Build Script
# Creates a production-ready ZIP file for Chrome Web Store submission or direct download (developer mode required)

set -e

EXTENSION_DIR="src"
DIST_DIR="dist"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Better Auto PiP - Build Script      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if source directory exists
if [ ! -d "$EXTENSION_DIR" ]; then
    echo -e "${RED}✗ Error: Source directory '$EXTENSION_DIR' not found${NC}"
    exit 1
fi

# Read version from manifest
VERSION=$(grep -o '"version": "[^"]*' "$EXTENSION_DIR/manifest.json" | sed 's/"version": "//')
echo -e "${BLUE}Building version: ${GREEN}$VERSION${NC}"

# Create dist directory
mkdir -p "$DIST_DIR"

# Build filename
BUILD_FILE="$DIST_DIR/better-auto-pip-v$VERSION.zip"

# Remove old build if exists
if [ -f "$BUILD_FILE" ]; then
    echo -e "${BLUE}Removing old build...${NC}"
    rm "$BUILD_FILE"
fi

# Create ZIP file
echo -e "${BLUE}Creating ZIP package...${NC}"
cd "$EXTENSION_DIR"
zip -r "../$BUILD_FILE" . \
    -x "*.git*" \
    -x "*.DS_Store" \
    -x "node_modules/*" \
    -x "*.md"
cd ..

# Get file size
SIZE=$(ls -lh "$BUILD_FILE" | awk '{print $5}')

echo ""
echo -e "${GREEN}✓ Build complete!${NC}"
echo -e "${BLUE}File: ${NC}$BUILD_FILE"
echo -e "${BLUE}Size: ${NC}$SIZE"
echo -e "${BLUE}Version: ${NC}$VERSION"
echo ""
echo -e "${GREEN}Ready for Chrome Web Store upload!${NC}"
