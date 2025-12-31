# Git Repository Setup Guide

This project uses a dual-remote setup with GitLab as the primary development platform and GitHub as a public mirror.

## Branch Structure

- **`main`** - Production-ready code, automatically mirrors to GitHub
- **`dev`** - Development branch (default working branch)

## Initial Setup

### 1. Configure Remotes

Run the setup script to add your GitLab and GitHub remotes:

```bash
./setup-remotes.sh
```

Or manually configure:

```bash
# Add GitLab as primary remote (origin)
git remote add origin git@gitlab.com:yourusername/better-auto-pip.git

# Add GitHub as mirror remote
git remote add github git@github.com:seanharsh/Better-Auto-PiP.git
```

### 2. Push Initial Branches

```bash
# Push dev branch to GitLab (set as default)
git push -u origin dev

# Push main branch to GitLab
git checkout main
git push -u origin main

# Push main branch to GitHub
git push -u github main

# Switch back to dev
git checkout dev
```

### 3. Set Default Branch

In GitLab:
1. Go to Settings → Repository → Default branch
2. Change to `dev`
3. Save changes

## GitLab CI/CD Setup for Auto-Mirroring

To automatically push `main` to GitHub when commits are made:

### 1. Generate SSH Deploy Key for GitHub

```bash
ssh-keygen -t ed25519 -C "gitlab-ci@better-auto-pip" -f ~/.ssh/github_deploy_key
```

### 2. Add Public Key to GitHub

1. Go to your GitHub repository
2. Settings → Deploy keys → Add deploy key
3. Paste contents of `~/.ssh/github_deploy_key.pub`
4. ✅ Check "Allow write access"
5. Add key

### 3. Add Private Key to GitLab

1. Go to your GitLab project
2. Settings → CI/CD → Variables
3. Add variable:
   - **Key**: `GITHUB_DEPLOY_KEY`
   - **Value**: Contents of `~/.ssh/github_deploy_key` (private key)
   - **Type**: File
   - **Protected**: Yes
   - **Masked**: No
4. Save variable

### 4. Update .gitlab-ci.yml

The `.gitlab-ci.yml` file is already configured to mirror to GitHub. Update the GitHub URL if needed:

```yaml
git remote add github git@github.com:seanharsh/Better-Auto-PiP.git || true
```

## Development Workflow

### Working on Features

```bash
# Always work on dev branch
git checkout dev

# Make changes, commit
git add .
git commit -m "Add: description of changes"

# Push to GitLab
git push origin dev
```

### Creating a Release

```bash
# Ensure dev is ready
git checkout dev
# Test thoroughly

# Merge to main
git checkout main
git merge dev

# Push to GitLab (this will auto-mirror to GitHub via CI/CD)
git push origin main

# Alternatively, manually push to both:
git push origin main && git push github main

# Tag the release
git tag v0.1.0
git push origin --tags
git push github --tags

# Switch back to dev
git checkout dev
```

## GitLab CI/CD Pipeline

The `.gitlab-ci.yml` pipeline includes:

1. **Build** (on every push to dev/main)
   - Creates a ZIP package for testing
   - Artifact expires in 30 days

2. **Mirror to GitHub** (automatic on main commits)
   - Pushes main branch to GitHub
   - Requires `GITHUB_DEPLOY_KEY` variable

3. **Release** (manual trigger on main)
   - Creates versioned release package
   - Artifact expires in 1 year

## Manual Workflow (Without CI/CD)

If you prefer not to use GitLab CI/CD auto-mirroring:

```bash
# After committing to main locally
git push origin main    # Push to GitLab
git push github main    # Push to GitHub
```

## Troubleshooting

### GitHub Mirror Not Working

1. Check GitLab CI/CD logs for errors
2. Verify `GITHUB_DEPLOY_KEY` variable is set correctly
3. Ensure GitHub deploy key has write access
4. Check that GitHub repository exists and you have access

### Permission Denied (SSH)

1. Ensure your SSH keys are added to ssh-agent
2. Test SSH connection: `ssh -T git@github.com`
3. Check SSH key permissions (should be 600)

## Remote URLs

View configured remotes:

```bash
git remote -v
```

Expected output:
```
github  git@github.com:seanharsh/Better-Auto-PiP.git (fetch)
github  git@github.com:seanharsh/Better-Auto-PiP.git (push)
origin  git@gitlab.com:yourusername/better-auto-pip.git (fetch)
origin  git@gitlab.com:yourusername/better-auto-pip.git (push)
```

## Best Practices

- ✅ Always develop on `dev` branch
- ✅ Only merge tested, working code to `main`
- ✅ Tag releases with semantic versioning (v0.1.0, v0.2.0, etc.)
- ✅ Write clear commit messages
- ✅ Test thoroughly before merging to `main`
- ✅ Keep `main` synchronized with GitHub
