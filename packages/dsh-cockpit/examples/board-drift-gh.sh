#!/usr/bin/env bash
# An example dsh-cockpit drift command. It is yours to copy and change: the
# plugin never runs it unless your profile names it in drift.command, for
# example:
#
#   drift: { command: 'bash /path/to/board-drift-gh.sh', cwd: '/path/to/repo', mode: report }
#
# The plugin runs drift.command through the shell on board_read({ checkDrift:
# true }), in drift.cwd, with the board's JSON on stdin and DSH_HOME,
# DSH_COCKPIT_KEY and DSH_COCKPIT_FILE set. The command prints
# { "items": [ { "item", "status"?, "note"? } ] } on stdout; the plugin keeps
# only the entries whose status differs from their task's.
#
# This one asks gh about the pr of each open task (not done, not dropped) and
# reports done for each PR that gh reports as merged. A pr is "#902" or "902"
# (gh then uses the repository of the working directory, drift.cwd),
# "owner/repo#902", or a PR URL. It needs gh and jq on PATH. A PR that gh
# cannot read is skipped, with a line on stderr; when gh can read none of
# them (not logged in, say), the check fails.
set -euo pipefail

for tool in gh jq; do
  command -v "$tool" >/dev/null || { echo "board-drift-gh: $tool is not on PATH" >&2; exit 127; }
done

board=$(cat)
# One line per open task with a pr: item and pr, each base64-encoded, so any
# character in them survives the shell.
tasks=$(jq -r '.tasks[] | select(.status != "done" and .status != "dropped" and (.pr // "") != "")
  | "\(.item | @base64)\t\(.pr | @base64)"' <<<"$board")

items=()
asked=0
failed=0
while IFS=$'\t' read -r item64 pr64; do
  [ -n "$item64" ] || continue
  pr=$(jq -rn --arg b "$pr64" '$b | @base64d')
  if [[ $pr =~ ^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#([0-9]+)$ ]]; then
    args=("${BASH_REMATCH[2]}" -R "${BASH_REMATCH[1]}")
  else
    args=("${pr#\#}")
  fi
  asked=$((asked + 1))
  if ! state=$(gh pr view "${args[@]}" --json state --jq .state); then
    failed=$((failed + 1))
    echo "board-drift-gh: skipped $pr: gh pr view failed" >&2
    continue
  fi
  if [ "$state" = MERGED ]; then
    items+=("$(jq -cn --arg b "$item64" --arg note "$pr merged" '{ item: ($b | @base64d), status: "done", note: $note }')")
  fi
done <<<"$tasks"

if [ "$asked" -gt 0 ] && [ "$failed" -eq "$asked" ]; then
  echo "board-drift-gh: gh could read none of the $asked PRs" >&2
  exit 1
fi

if [ ${#items[@]} -eq 0 ]; then
  echo '{"items":[]}'
else
  printf '%s\n' "${items[@]}" | jq -cs '{ items: . }'
fi
