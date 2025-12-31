#!/bin/bash

# Better Auto PiP - Remote Setup Script
# This script configures GitLab as the primary remote and GitHub as a mirror

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Better Auto PiP - Remote Setup      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Get GitLab URL
echo -e "${YELLOW}Enter your GitLab repository URL:${NC}"
echo -e "${BLUE}(e.g., git@gitlab.com:username/better-auto-pip.git)${NC}"
read GITLAB_URL

if [ -z "$GITLAB_URL" ]; then
    echo -e "${RED}✗ GitLab URL is required${NC}"
    exit 1
fi

# Get GitHub URL
echo ""
echo -e "${YELLOW}Enter your GitHub repository URL:${NC}"
echo -e "${BLUE}(e.g., git@github.com:seanharsh/Better-Auto-PiP.git)${NC}"
read GITHUB_URL

if [ -z "$GITHUB_URL" ]; then
    echo -e "${RED}✗ GitHub URL is required${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Configuring remotes...${NC}"

# Set GitLab as origin (primary remote)
git remote add origin "$GITLAB_URL"
echo -e "${GREEN}✓ Added GitLab as 'origin'${NC}"

# Set GitHub as github remote
git remote add github "$GITHUB_URL"
echo -e "${GREEN}✓ Added GitHub as 'github'${NC}"

echo ""
echo -e "${GREEN}✓ Remote configuration complete!${NC}"
echo ""
echo -e "${BLUE}Remote URLs:${NC}"
git remote -v
echo ""
echo -e "${BLUE}Workflow:${NC}"
echo -e "  1. Work on ${YELLOW}dev${NC} branch (default)"
echo -e "  2. Push to GitLab: ${YELLOW}git push origin dev${NC}"
echo -e "  3. When ready for release, merge to ${YELLOW}main${NC}"
echo -e "  4. Push main to both remotes: ${YELLOW}git push origin main && git push github main${NC}"
echo ""
echo -e "${YELLOW}Note: You can set up automatic GitHub mirroring in GitLab:${NC}"
echo -e "  Settings → Repository → Mirroring repositories"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo -e "  ${YELLOW}git push -u origin dev${NC}        # Push dev branch to GitLab"
echo -e "  ${YELLOW}git push -u origin main${NC}       # Push main branch to GitLab"
echo -e "  ${YELLOW}git push -u github main${NC}       # Push main branch to GitHub"
echo ""
