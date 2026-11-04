#!/usr/bin/env bash
set -euo pipefail
# Called only by the tested main-branch release job; never replaces a published release.
release_version=$(node -p 'require("./package.json").version')
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
release_tag="v$release_version"
release_notes="docs/RELEASE-$release_version.md"
release_assets=(dist/vacation-planner.html dist/README.md dist/LICENSE dist/RELEASE-NOTES.md dist/SHA256SUMS.txt)
if gh release view "$release_tag" --json isDraft,targetCommitish > "$RUNNER_TEMP/vacation-release.json"; then
  release_draft=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).isDraft' "$RUNNER_TEMP/vacation-release.json")
  if [[ "$release_draft" == "false" ]]; then
    printf 'Release %s is already published; keeping it unchanged.\n' "$release_tag"
    exit 0
  fi
  release_target=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).targetCommitish' "$RUNNER_TEMP/vacation-release.json")
  [[ "$release_target" == "$GITHUB_SHA" ]] || { printf 'Draft targets another commit; refusing to replace it.\n' >&2; exit 1; }
  gh release upload "$release_tag" "${release_assets[@]}" --clobber
  gh release edit "$release_tag" --draft=false --latest --notes-file "$release_notes"
else
  gh release create "$release_tag" "${release_assets[@]}" \
    --target "$GITHUB_SHA" --title "Vacation Planner $release_tag · График отпусков" \
    --notes-file "$release_notes" --latest
fi
