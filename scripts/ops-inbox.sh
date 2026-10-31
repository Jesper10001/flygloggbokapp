#!/bin/bash
# Blades Ops → Claude: uppgifter som skrivits på driftsidan https://api.blades-app.com/ops.
# SessionStart-hooken i .claude/settings.json kör skriptet utan argument; det som skrivs ut hamnar i
# Claudes kontext. Tyst om token saknas, nätet ligger nere eller inkorgen är tom.
#
#   bash scripts/ops-inbox.sh                        visa öppna uppgifter till Claude
#   bash scripts/ops-inbox.sh done <id> "notering"   bocka av (noteringen syns på sidan)
#   bash scripts/ops-inbox.sh ask "text"             lägg en uppgift till användaren på sidan
#   bash scripts/ops-inbox.sh sentry <id>            hela felrapporten för ett Sentry-fel (JSON, via proxyn)
#
# Token: ~/.config/blades-ops/token, samma värde som Workerns secret CLAUDE_TASKS_TOKEN.
# Den skickas via stdin till curl (syns inte i processlistan) och skrivs aldrig ut.
BASE="${BLADES_OPS_INBOX_URL:-https://api.blades-app.com/ops/inbox}"
TOKEN_FILE="${BLADES_OPS_TOKEN_FILE:-$HOME/.config/blades-ops/token}"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
[ -r "$TOKEN_FILE" ] || exit 0

auth() { printf 'Authorization: Bearer %s\n' "$(tr -d ' \r\n' < "$TOKEN_FILE")"; }

case "${1:-}" in
  done)
    [ -n "${2:-}" ] || { echo "Användning: bash $SELF done <id> \"notering\"" >&2; exit 2; }
    auth | curl -sS --max-time 10 -H @- --data-urlencode "id=$2" --data-urlencode "note=${3:-Klar}" "$BASE/done"
    echo
    ;;
  ask)
    [ -n "${2:-}" ] || { echo "Användning: bash $SELF ask \"text\"" >&2; exit 2; }
    auth | curl -sS --max-time 10 -H @- --data-urlencode "text=$2" "$BASE/add"
    echo
    ;;
  sentry)
    case "${2:-}" in ''|*[!0-9]*) echo "Användning: bash $SELF sentry <fel-id (siffror)>" >&2; exit 2 ;; esac
    auth | curl -sS --max-time 20 -H @- "$BASE/sentry?id=$2"
    echo
    ;;
  *)
    out=$(auth | curl -sS --max-time 4 -H @- -w $'\n%{http_code}' "$BASE?format=text" 2>/dev/null) || exit 0
    code="${out##*$'\n'}"
    body="${out%$'\n'*}"
    if [ "$code" = "401" ]; then
      echo "Blades Ops: inkorgen avvisade token. Kontrollera att ~/.config/blades-ops/token och Workerns secret CLAUDE_TASKS_TOKEN har samma värde."
    elif [ "$code" = "200" ] && [ -n "$body" ]; then
      echo "Blades Ops: öppna uppgifter som användaren skrivit till Claude på driftsidan (api.blades-app.com/ops):"
      printf '%s\n' "$body"
      echo
      echo "Gör dem som om användaren skrivit dem här, med samma regler som vanligt: ingen commit utan OK. Hemsidan får deployas efter kontroll, proxyn bara om uppgiften uttryckligen ber om det. Fråga om något är oklart."
      echo "Bocka av varje uppgift när den är klar:  bash \"$SELF\" done <id> \"kort notering till användaren om vad som gjordes\""
      echo "Kräver något användaren (nycklar, EAS-bygge, App Store Connect, en proxy-deploy som inte begärts):  bash \"$SELF\" ask \"vad som ska göras\""
    fi
    ;;
esac
exit 0
