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
# This one asks gh about each task's pr and reports done for each PR that gh
# reports as merged. A pr is "#902" or "902" (gh then uses the repository of
# the working directory, drift.cwd), "owner/repo#902", or a PR URL. It needs
# gh and jq on PATH. A PR that gh cannot read is skipped, with a line on
# stderr.
set -euo pipefail

board=$(cat)
items=()

while IFS=$'\t' read -r item pr; do
  [ -n "$pr" ] || continue
  args=()
  if [[ $pr =~ ^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#([0-9]+)$ ]]; then
    args=("${BASH_REMATCH[2]}" -R "${BASH_REMATCH[1]}")
  else
    args=("${pr#\#}")
  fi
  if ! state=$(gh pr view "${args[@]}" --json state --jq .state); then
    echo "board-drift-gh: skipped $item: gh pr view $pr failed" >&2
    continue
  fi
  if [ "$state" = MERGED ]; then
    items+=("$(jq -cn --arg item "$item" --arg note "$pr merged" '{ item: $item, status: "done", note: $note }')")
  fi
done < <(jq -r '.tasks[] | select((.pr // "") != "") | [.item, .pr] | @tsv' <<<"$board")

if [ ${#items[@]} -eq 0 ]; then
  echo '{"items":[]}'
else
  printf '%s\n' "${items[@]}" | jq -cs '{ items: . }'
fi
