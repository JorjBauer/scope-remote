#!/bin/sh
# Publish dist/release/ as a GitHub release. Run by `make release`, after
# `make dist`.

set -e

REMOTE=${GITHUB_REMOTE:-github}
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

die() {
  echo "release: $*" >&2
  exit 1
}

command -v gh >/dev/null || die "needs the GitHub CLI: brew install gh, then gh auth login"
gh auth status >/dev/null 2>&1 || die "gh isn't logged in: run gh auth login"

URL=$(git remote get-url "$REMOTE" 2>/dev/null) || die "no git remote called $REMOTE (set GITHUB_REMOTE to use another)"
case "$URL" in
  git@github.com:*/* | https://github.com/*/* | ssh://git@github.com/*/*) ;;
  *) die "$REMOTE ($URL) doesn't look like a GitHub repo" ;;
esac
REPO=$(echo "$URL" | sed -E 's#^(git@github\.com:|https://github\.com/|ssh://git@github\.com/)##; s#\.git$##')

[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"

HEAD=$(git rev-parse HEAD)
LOCAL=$(git rev-parse -q --verify "refs/tags/$TAG^{commit}") ||
  die "no tag $TAG (package.json says $VERSION). Tag it: git tag $TAG && git push $REMOTE $TAG"
[ "$LOCAL" = "$HEAD" ] || die "$TAG is $(git rev-parse --short "$LOCAL"), but HEAD is $(git rev-parse --short HEAD)"

# The peeled line (^{}) is the commit an annotated tag points at.
REMOTE_TAG=$(git ls-remote --tags "$REMOTE" "refs/tags/$TAG" "refs/tags/$TAG^{}" | awk '{print $1}' | tail -1)
[ -n "$REMOTE_TAG" ] || die "$TAG isn't on $REMOTE yet: git push $REMOTE $TAG"
[ "$REMOTE_TAG" = "$HEAD" ] || die "$TAG on $REMOTE points somewhere other than HEAD"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  die "$REPO already has a release $TAG. Bump the version in package.json for a new one."
fi

FILES=""
for f in darwin-x64.zip darwin-arm64.zip win32-x64.zip linux-x64.tar.gz; do
  p="dist/release/scope-remote-$VERSION-$f"
  [ -f "$p" ] || die "missing $p (make dist builds it)"
  FILES="$FILES $p"
done

# Release notes: which file to grab, then the README's first-launch help.
NOTES=dist/release/notes.md
{
  echo "Which file:"
  echo
  echo "- Intel Mac: \`scope-remote-$VERSION-darwin-x64.zip\`"
  echo "- Apple Silicon Mac: \`scope-remote-$VERSION-darwin-arm64.zip\`"
  echo "- Windows: \`scope-remote-$VERSION-win32-x64.zip\`"
  echo "- Linux: \`scope-remote-$VERSION-linux-x64.tar.gz\`"
  echo
  awk '/^None of these are signed/ { on = 1 } on && /^## / { exit } on' README.md
} > "$NOTES"
grep -q 'None of these are signed' "$NOTES" ||
  die "couldn't find the first-launch section in README.md (it starts \"None of these are signed\")"

echo
echo "About to publish $TAG to https://github.com/$REPO/releases"
for f in $FILES; do
  echo "  $f ($(du -h "$f" | cut -f1 | tr -d ' '))"
done
echo "Notes: $NOTES"
printf 'Publish? [y/N] '
read -r answer
case "$answer" in
  y|Y|yes) ;;
  *) die "not published" ;;
esac

gh release create "$TAG" $FILES --repo "$REPO" --verify-tag \
  --title "Scope Remote $VERSION" --notes-file "$NOTES"
