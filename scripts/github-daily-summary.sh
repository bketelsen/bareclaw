#!/bin/bash
# Daily GitHub activity summary for bketelsen and frostyard
# Sends results to Telegram via BAREclaw /send endpoint

set -euo pipefail

BARECLAW_URL="http://localhost:3000"
CHANNEL="tg-8797848146"
GH="/home/linuxbrew/.linuxbrew/bin/gh"
JQ="/home/linuxbrew/.linuxbrew/bin/jq"
export PATH="/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin"

yesterday=$(date -d "yesterday" +%Y-%m-%d)
today=$(date +%Y-%m-%d)

summary="**GitHub Daily Summary — ${today}**"$'\n'

for user in bketelsen frostyard; do
  summary+=$'\n'"**${user}**"$'\n'

  # Fetch all events from yesterday
  raw=$($GH api "users/${user}/events" --paginate 2>/dev/null || echo "[]")
  day_events=$(echo "$raw" | $JQ -r \
    "[.[] | select(.created_at >= \"${yesterday}T00:00:00Z\" and .created_at < \"${today}T00:00:00Z\")]" 2>/dev/null)

  count=$(echo "$day_events" | $JQ 'length')

  if [ "$count" = "0" ]; then
    summary+="No activity yesterday."$'\n'
    continue
  fi

  # Pushes — show repo, branch, commit count and messages
  pushes=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "PushEvent") | select(.payload.commits != null and (.payload.commits | length) > 0)] |
    if length == 0 then empty else
    group_by(.repo.name) |
    .[] |
    "  \(.[0].repo.name | split("/")[1]) (\(.[0].payload.ref | split("/")[-1])): \([.[] | .payload.commits | length] | add) commit(s)\n" +
    ([.[] | .payload.commits[]? | .message | split("\n")[0] // empty | "    - \(.)"] | unique | join("\n"))
    end
  ' 2>/dev/null)

  if [ -n "$pushes" ]; then
    summary+=$'\n'"Pushes:"$'\n'"${pushes}"$'\n'
  fi

  # Pull requests
  prs=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "PullRequestEvent")] |
    .[] |
    "  \(.payload.action) #\(.payload.pull_request.number) in \(.repo.name | split("/")[1]): \(.payload.pull_request.title // "untitled")"
  ' 2>/dev/null)

  if [ -n "$prs" ]; then
    summary+=$'\n'"Pull Requests:"$'\n'"${prs}"$'\n'
  fi

  # Issues
  issues=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "IssuesEvent")] |
    .[] |
    "  \(.payload.action) #\(.payload.issue.number) in \(.repo.name | split("/")[1]): \(.payload.issue.title // "untitled")"
  ' 2>/dev/null)

  if [ -n "$issues" ]; then
    summary+=$'\n'"Issues:"$'\n'"${issues}"$'\n'
  fi

  # Issue/PR comments
  comments=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "IssueCommentEvent")] |
    .[] |
    "  \(.repo.name | split("/")[1])#\(.payload.issue.number // "?"): \(.payload.comment.body // "" | split("\n")[0] | .[0:80])"
  ' 2>/dev/null)

  if [ -n "$comments" ]; then
    summary+=$'\n'"Comments:"$'\n'"${comments}"$'\n'
  fi

  # Releases
  releases=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "ReleaseEvent")] |
    .[] |
    "  \(.payload.action) \(.payload.release.tag_name // "?") in \(.repo.name | split("/")[1]): \(.payload.release.name // .payload.release.tag_name // "no title")"
  ' 2>/dev/null)

  if [ -n "$releases" ]; then
    summary+=$'\n'"Releases:"$'\n'"${releases}"$'\n'
  fi

  # Repo creation
  created=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "CreateEvent" and .payload.ref_type == "repository")] |
    .[] |
    "  \(.repo.name | split("/")[1])"
  ' 2>/dev/null)

  if [ -n "$created" ]; then
    summary+=$'\n'"New Repos:"$'\n'"${created}"$'\n'
  fi

  # Stars given
  stars=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "WatchEvent")] |
    .[] |
    "  \(.repo.name)"
  ' 2>/dev/null)

  if [ -n "$stars" ]; then
    summary+=$'\n'"Starred:"$'\n'"${stars}"$'\n'
  fi

  # Forks
  forks=$(echo "$day_events" | $JQ -r '
    [.[] | select(.type == "ForkEvent")] |
    .[] |
    "  forked \(.repo.name | split("/")[1]) -> \(.payload.forkee.full_name // "unknown")"
  ' 2>/dev/null)

  if [ -n "$forks" ]; then
    summary+=$'\n'"Forks:"$'\n'"${forks}"$'\n'
  fi
done

# Send via BAREclaw
curl -s -X POST "${BARECLAW_URL}/send" \
  -H 'Content-Type: application/json' \
  -d "$($JQ -n --arg ch "$CHANNEL" --arg txt "$summary" '{channel: $ch, text: $txt}')"
