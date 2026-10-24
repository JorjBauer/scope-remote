#!/bin/sh
# Publish dist/release/ as a GitHub release. `make release` runs it twice:
#
#   tools/release.sh check   the safety checks only, before building, so a
#                            version you forgot to bump fails in seconds
#   tools/release.sh         the checks again, then the upload, after
#                            `make dist`

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

# First, because it's the likeliest mistake: a release for this version
# already exists, so package.json wasn't bumped. Anything other than a clean
# "not found" (no network, bad login) stops here too, rather than passing.
if out=$(gh release view "$TAG" --repo "$REPO" 2>&1 >/dev/null); then
  die "$REPO already has a release $TAG. Did you forget to bump the version in package.json?"
fi
case "$out" in
  *"not found"*) ;;
  *) die "couldn't ask GitHub about $TAG: $out" ;;
esac

[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"

HEAD=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)

# The release is of HEAD, so GitHub has to have that commit already.
git fetch -q "$REMOTE"
git branch -r --contains HEAD | grep -q "^ *$REMOTE/" ||
  die "$SHORT isn't on $REMOTE yet; push it first"

# The tag comes from package.json. It's made here if it doesn't exist yet;
# if it does, locally or on GitHub, it has to be HEAD already.
LOCAL=$(git rev-parse -q --verify "refs/tags/$TAG^{commit}" || true)
[ -z "$LOCAL" ] || [ "$LOCAL" = "$HEAD" ] ||
  die "$TAG is already $(git rev-parse --short "$LOCAL"), not HEAD ($SHORT). Bump the version in package.json for a new release."
# The peeled line (^{}) is the commit an annotated tag points at.
REMOTE_TAG=$(git ls-remote --tags "$REMOTE" "refs/tags/$TAG" "refs/tags/$TAG^{}" | awk '{print $1}' | tail -1)
[ -z "$REMOTE_TAG" ] || [ "$REMOTE_TAG" = "$HEAD" ] ||
  die "$TAG on $REMOTE isn't HEAD ($SHORT). Bump the version in package.json for a new release."

if [ "$1" = check ]; then
  echo "release: $TAG of $SHORT looks ready to publish to $REPO"
  exit 0
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
[ -n "$REMOTE_TAG" ] || echo "  and tag $SHORT as $TAG on GitHub$([ -n "$LOCAL" ] || echo ' and here')"
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

# --target makes GitHub create the tag at HEAD if it isn't there yet.
gh release create "$TAG" $FILES --repo "$REPO" --target "$HEAD" \
  --title "Scope Remote $VERSION" --notes-file "$NOTES"
[ -n "$LOCAL" ] || git tag "$TAG" "$HEAD"
echo "Tagged $SHORT as $TAG. To put the tag on another remote too: git push origin $TAG"
