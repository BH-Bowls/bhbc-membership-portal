#!/bin/bash
# Cleanup script to remove bowling-specific features
# Run this in the NEW project directory (after copying)

echo "🧹 Cleaning up bowling-specific features..."

# Remove Friendlies system
echo "Removing friendlies system..."
rm -rf app/friendlies
rm -rf app/api/friendlies
rm -f src/lib/friendlies-sheets.ts
rm -f src/lib/types/friendlies.ts

# Remove Banking system
echo "Removing banking system..."
rm -rf app/banking
rm -rf app/api/banking
rm -f src/lib/banking-match.ts

# Remove Renewals
echo "Removing renewals system..."
rm -rf app/renewals
rm -rf app/api/renewals

# Remove bowling-specific documentation
echo "Removing bowling-specific docs..."
rm -f FRIENDLIES_*.md
rm -f specs/Friendly\ Files/*

# Clean up components folder (remove bowling-specific components if any)
echo "Checking components folder..."
# Keep Navbar.tsx - we'll edit it manually

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update package.json (name, description)"
echo "2. Clean up Navbar.tsx (remove bowling menu items)"
echo "3. Update src/lib/sheets.ts User interface for your needs"
echo "4. Create new .env.local with your Google Workspace credentials"
echo "5. Create new Google Sheet for your project"
echo ""
echo "Run: npm install"
echo "Then: npm run dev"
