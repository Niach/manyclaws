---
name: manyclaws-portal
description: "Generate friend portal login links. Use when a friend needs access to their portal, or when someone asks for a login link. Also triggered by: Portal, Login-Link, Portal-Zugang, mein Portal, ich will ins Portal."
---

# Friend Portal Login

Generate a portal session link so a friend can access their portal.

## Usage

1. Call the controller API to create a 30-day portal session:

```bash
curl -s -X POST http://manyclaws-controller.manyclaws-system.svc/api/auth/portal-session \
  -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"friend_id": "<friend-id>", "agent": "<your-agent-name>"}'
```

2. Response: `{"portal_url": "https://<agent>.your-domain.net/portal?s=<token>", "session_token": "...", "expires_at": "...", "expires_in": 2592000}`

3. Send the `portal_url` directly to the friend in the current conversation. The link is valid for 30 days.

## Friend IDs

Friend IDs match the identityLinks canonical names in the config. Use the canonical name of the person you're talking to. You can list available friends by checking the `friends/` directory in your workspace.

## CRITICAL

**Always use the friend_id of the person you are CURRENTLY talking to. Double-check the canonical name matches the conversation peer. Passing the wrong friend_id is a security breach — it gives the wrong person access to someone else's data.**

## Notes

- The friend must already exist in the workspace (friends/<id>/profile.json) — the API will reject unknown IDs
- Friend IDs should be lowercase, no spaces (use hyphens for multi-word: lord-helmchen)
- The link is valid for 30 days — no rush to click it
- Clicking it logs the friend directly into their portal (no redirect chain)
- Portal URL: `https://<agent>.your-domain.net/portal`
