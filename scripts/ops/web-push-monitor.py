"""通过独立 SMTP 通道发送 Web Push 聚合告警；输出中不包含凭据或个人资料。"""

import json
import math
import os
from pathlib import Path
import smtplib
import ssl
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formatdate, make_msgid


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("MONITOR_REDIRECT_REJECTED")


def validate_snapshot(value):
    if not isinstance(value, dict) or type(value.get("featureEnabled")) is not bool:
        raise ValueError("MONITOR_SNAPSHOT_INVALID")
    if value.get("integrationStatus") not in ("disabled", "enabled", "degraded"):
        raise ValueError("MONITOR_SNAPSHOT_INVALID")
    if type(value.get("providerAuthError")) is not bool:
        raise ValueError("MONITOR_SNAPSHOT_INVALID")
    for field in ("workerAgeSeconds", "oldestDueSeconds", "dead", "failed24h", "queued", "sent24h"):
        number = value.get(field)
        if field == "workerAgeSeconds" and number is None:
            continue
        if type(number) not in (int, float) or not math.isfinite(number) or number < 0:
            raise ValueError("MONITOR_SNAPSHOT_INVALID")
    return {key: value[key] for key in (
        "featureEnabled", "integrationStatus", "providerAuthError", "workerAgeSeconds",
        "oldestDueSeconds", "dead", "failed24h", "queued", "sent24h",
    )}


def classify(snapshot, previous, now):
    if snapshot is None:
        return ["MONITOR_READ_FAILED"], None
    if not snapshot["featureEnabled"] or snapshot["integrationStatus"] == "disabled":
        return [], None
    issues = []
    if snapshot["workerAgeSeconds"] is None or snapshot["workerAgeSeconds"] > 120:
        issues.append("WORKER_STALE")
    if snapshot["providerAuthError"]:
        issues.append("PROVIDER_AUTH_ERROR")
    if snapshot["integrationStatus"] == "degraded":
        issues.append("CHANNEL_DEGRADED")
    if snapshot["dead"] > 0:
        issues.append("DEAD_JOBS")
    if snapshot["failed24h"] > 0:
        issues.append("FAILED_DELIVERIES")
    slow_since = previous.get("slowSince", now) if snapshot["oldestDueSeconds"] > 60 else None
    if slow_since is None and snapshot["oldestDueSeconds"] > 60:
        slow_since = now
    if slow_since is not None and now - slow_since >= 300:
        issues.append("QUEUE_STALLED")
    return sorted(issues), slow_since


def poll(snapshot, previous, now, send):
    issues, slow_since = classify(snapshot, previous, now)
    prior = previous.get("issues", [])
    # 同一故障每小时最多补报一次，恢复只发送一封。
    due = issues != prior or (bool(issues) and now - previous.get("lastSent", 0) >= 3600)
    last_sent = previous.get("lastSent", 0)
    if due:
        kind = "alert" if issues else "recovered"
        send(kind, issues, snapshot)
        last_sent = now
    return {"issues": issues, "slowSince": slow_since, "lastSent": last_sent, "lastChecked": now}


def read_snapshot(env):
    origin = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    url = urllib.parse.urlsplit(origin)
    local = url.hostname in ("localhost", "127.0.0.1", "::1")
    if (url.scheme != "https" and not (url.scheme == "http" and local)) or url.username or url.password:
        raise ValueError("MONITOR_TARGET_INVALID")
    if url.path or url.query or url.fragment:
        raise ValueError("MONITOR_TARGET_INVALID")
    key = env["SUPABASE_SECRET_KEY"]
    req = urllib.request.Request(origin + "/rest/v1/rpc/get_web_push_monitor_snapshot", data=b"{}", headers={
        "apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json",
    })
    opener = urllib.request.build_opener(NoRedirects())
    with opener.open(req, timeout=15) as response:
        payload = response.read(65537)
    if len(payload) > 65536:
        raise ValueError("MONITOR_RESPONSE_TOO_LARGE")
    return validate_snapshot(json.loads(payload))


def send_email(env, kind, issues, snapshot):
    msg = EmailMessage()
    msg["Subject"] = "[Mathin Web Push] " + ("Recovery" if kind == "recovered" else "Alert")
    msg["From"] = env["MATHIN_WEB_PUSH_SMTP_FROM"]
    msg["To"] = env["MATHIN_WEB_PUSH_ALERT_TO"]
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain="mathin.club")
    body = "Mathin employee desktop reminders\nState: " + kind + "\nCodes: " + (", ".join(issues) or "none")
    if snapshot is not None:
        safe = validate_snapshot(snapshot)
        body += "\n\nAggregates:\n" + json.dumps(safe, sort_keys=True, indent=2)
    msg.set_content(body + "\n\nInspect the system-health dashboard and the Web Push worker journal.\n")
    host = env["MATHIN_WEB_PUSH_SMTP_HOST"]
    port = int(env["MATHIN_WEB_PUSH_SMTP_PORT"])
    context = ssl.create_default_context()
    if port == 465:
        client = smtplib.SMTP_SSL(host, port, timeout=20, context=context)
    elif port == 587:
        client = smtplib.SMTP(host, port, timeout=20)
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
    else:
        raise ValueError("MONITOR_SMTP_TLS_REQUIRED")
    with client:
        client.login(env["MATHIN_WEB_PUSH_SMTP_USER"], env["MATHIN_WEB_PUSH_SMTP_PASSWORD"])
        if client.send_message(msg):
            raise ValueError("MONITOR_SMTP_RECIPIENT_REJECTED")


def main():
    state_path = Path(os.environ["MATHIN_WEB_PUSH_MONITOR_STATE"])
    if not state_path.is_absolute():
        raise ValueError("MONITOR_STATE_PATH_INVALID")
    previous = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    try:
        snapshot = read_snapshot(os.environ)
    except Exception:
        snapshot = None
    state = poll(snapshot, previous, time.time(), lambda kind, issues, data: send_email(os.environ, kind, issues, data))
    state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = state_path.with_suffix(".pending")
    fd = os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(state, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, state_path)
    print(json.dumps({"event": "web_push.monitor", "issues": state["issues"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"event": "web_push.monitor_failed", "errorClass": type(error).__name__}))
        raise SystemExit(1)
